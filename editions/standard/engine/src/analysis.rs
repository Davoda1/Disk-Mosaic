use crate::model::{HiddenMode, Node, NodeId, NodeKind, NodeSummary, ScanModel};
use serde::{Deserialize, Serialize};
use std::cmp::Reverse;
use std::collections::{BinaryHeap, HashMap, HashSet};

const DAY_MS: u64 = 86_400_000;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct FilterSpec {
    #[serde(default)] pub filename_contains: String,
    #[serde(default)] pub path_contains: String,
    #[serde(default)] pub extensions_any: Vec<String>,
    #[serde(default)] pub categories_any: Vec<String>,
    #[serde(default)] pub type_hints_any: Vec<String>,
    pub kind: Option<NodeKind>,
    pub min_logical: Option<u64>,
    pub max_logical: Option<u64>,
    pub min_allocated: Option<u64>,
    pub max_allocated: Option<u64>,
    pub modified_before_ms: Option<u64>,
    pub modified_after_ms: Option<u64>,
    pub modified_unknown: Option<bool>,
    pub created_before_ms: Option<u64>,
    pub created_after_ms: Option<u64>,
    pub min_age_days: Option<u64>,
    pub max_age_days: Option<u64>,
    pub sparse: Option<bool>,
    pub compressed: Option<bool>,
    pub min_hard_links: Option<u64>,
    pub max_hard_links: Option<u64>,
    pub duplicate: Option<bool>,
    #[serde(default)] pub owner_contains: String,
    #[serde(default)] pub permissions_contains: String,
    pub device: Option<u64>,
    #[serde(default)] pub change_states_any: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AdvancedFilterQuery {
    #[serde(default)] pub all: FilterSpec,
    /// One or more alternative filter groups. If non-empty, at least one group must match.
    #[serde(default)] pub any: Vec<FilterSpec>,
    #[serde(default)] pub offset: usize,
    #[serde(default = "default_filter_limit")] pub limit: usize,
    #[serde(default)] pub sort: FilterSort,
    #[serde(default = "default_true")] pub descending: bool,
    #[serde(default)] pub hidden_mode: HiddenMode,
}
fn default_filter_limit() -> usize { 500 }
fn default_true() -> bool { true }

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FilterSort { #[default] Logical, Allocated, Modified, Created, Name }

#[derive(Debug, Clone, Serialize)]
pub struct FilterResult {
    pub total: usize,
    pub offset: usize,
    pub limit: usize,
    pub truncated: bool,
    pub items: Vec<NodeSummary>,
}

pub fn advanced_filter(
    model: &ScanModel,
    query: &AdvancedFilterQuery,
    duplicate_ids: &HashSet<NodeId>,
    change_states: &HashMap<NodeId, String>,
    now_ms: u64,
) -> FilterResult {
    let limit = query.limit.clamp(1, 5000);
    // Bound deep pagination so the retained top-K window stays both correct and memory-bounded.
    // Renderer/Smart Collection paging never needs more than this investigation window.
    let offset = query.offset.min(15_000);
    let retain = offset.saturating_add(limit);
    let need_path = spec_needs_path(&query.all) || query.any.iter().any(spec_needs_path);
    let visible = model.visibility_mask(query.hidden_mode);
    let mut total = 0usize;

    // The default and overwhelmingly common size/date sorts use a bounded top-K heap so a
    // million-node scan never becomes a million-element renderer or Rust result allocation.
    let mut numeric_heap: BinaryHeap<Reverse<(u64, NodeId)>> = BinaryHeap::new();
    let mut name_asc: BinaryHeap<(String, NodeId)> = BinaryHeap::new();
    let mut name_desc: BinaryHeap<Reverse<(String, NodeId)>> = BinaryHeap::new();
    for node in model.nodes.iter().filter(|n| n.active && visible.get(n.id as usize).copied().unwrap_or(false)) {
        let path = if need_path { Some(model.path_for(node.id)) } else { None };
        if !matches_spec(node, path.as_deref(), &query.all, duplicate_ids, change_states, now_ms) { continue; }
        if !query.any.is_empty() && !query.any.iter().any(|spec| matches_spec(node, path.as_deref(), spec, duplicate_ids, change_states, now_ms)) { continue; }
        total = total.saturating_add(1);
        match query.sort {
            FilterSort::Logical | FilterSort::Allocated | FilterSort::Modified | FilterSort::Created => {
                let key = sort_key(node, query.sort, query.descending);
                if numeric_heap.len() < retain { numeric_heap.push(Reverse((key, node.id))); }
                else if let Some(Reverse((smallest, _))) = numeric_heap.peek().copied() {
                    if key > smallest { numeric_heap.pop(); numeric_heap.push(Reverse((key, node.id))); }
                }
            }
            FilterSort::Name => {
                // Keep only the globally relevant name-sort window rather than the first
                // matching nodes encountered in scan order.
                let key = node.name.to_lowercase();
                if query.descending {
                    if name_desc.len() < retain { name_desc.push(Reverse((key, node.id))); }
                    else if let Some(Reverse((smallest, _))) = name_desc.peek() {
                        if &key > smallest { name_desc.pop(); name_desc.push(Reverse((key, node.id))); }
                    }
                } else if name_asc.len() < retain { name_asc.push((key, node.id)); }
                else if let Some((largest, _)) = name_asc.peek() {
                    if &key < largest { name_asc.pop(); name_asc.push((key, node.id)); }
                }
            }
        }
    }
    let mut ids: Vec<NodeId> = match query.sort {
        FilterSort::Name if query.descending => name_desc.into_iter().map(|Reverse((_, id))| id).collect(),
        FilterSort::Name => name_asc.into_iter().map(|(_, id)| id).collect(),
        _ => numeric_heap.into_iter().map(|Reverse((_, id))| id).collect(),
    };
    ids.sort_by(|a,b| compare_nodes(&model.nodes[*a as usize], &model.nodes[*b as usize], query.sort, query.descending));
    let items = ids.into_iter().skip(offset).take(limit).filter_map(|id| model.node_summary(id)).collect();
    FilterResult { total, offset, limit, truncated: total > offset.saturating_add(limit), items }
}

fn sort_key(node: &Node, sort: FilterSort, descending: bool) -> u64 {
    let raw = match sort { FilterSort::Logical => node.size, FilterSort::Allocated => node.allocated_size,
        FilterSort::Modified => node.modified_ms.unwrap_or(0), FilterSort::Created => node.created_ms.unwrap_or(0), FilterSort::Name => 0 };
    if descending { raw } else { u64::MAX.saturating_sub(raw) }
}
fn compare_nodes(a:&Node,b:&Node,sort:FilterSort,descending:bool)->std::cmp::Ordering {
    let ord = match sort { FilterSort::Logical=>a.size.cmp(&b.size), FilterSort::Allocated=>a.allocated_size.cmp(&b.allocated_size),
        FilterSort::Modified=>a.modified_ms.cmp(&b.modified_ms), FilterSort::Created=>a.created_ms.cmp(&b.created_ms),
        FilterSort::Name=>a.name.to_lowercase().cmp(&b.name.to_lowercase()) }.then_with(|| a.id.cmp(&b.id));
    if descending { ord.reverse() } else { ord }
}
fn spec_needs_path(s:&FilterSpec)->bool { !s.path_contains.is_empty() }
fn norm_ext(s:&str)->String { s.trim().trim_start_matches('.').to_ascii_lowercase() }
fn lc_contains(hay:&str, needle:&str)->bool { needle.is_empty() || hay.to_lowercase().contains(&needle.to_lowercase()) }

fn matches_spec(node:&Node,path:Option<&str>,s:&FilterSpec,duplicates:&HashSet<NodeId>,changes:&HashMap<NodeId,String>,now_ms:u64)->bool {
    if !lc_contains(&node.name,&s.filename_contains) { return false; }
    if !s.path_contains.is_empty() && !lc_contains(path.unwrap_or(""),&s.path_contains) { return false; }
    if let Some(kind)=s.kind { if node.kind != kind { return false; } }
    if let Some(v)=s.min_logical { if node.size < v { return false; } }
    if let Some(v)=s.max_logical { if node.size > v { return false; } }
    if let Some(v)=s.min_allocated { if node.allocated_size < v { return false; } }
    if let Some(v)=s.max_allocated { if node.allocated_size > v { return false; } }
    if let Some(v)=s.modified_before_ms { if node.modified_ms.map_or(true,|m| m >= v) { return false; } }
    if let Some(v)=s.modified_after_ms { if node.modified_ms.map_or(true,|m| m <= v) { return false; } }
    if let Some(v)=s.modified_unknown { if node.modified_ms.is_none() != v { return false; } }
    if let Some(v)=s.created_before_ms { if node.created_ms.map_or(true,|m| m >= v) { return false; } }
    if let Some(v)=s.created_after_ms { if node.created_ms.map_or(true,|m| m <= v) { return false; } }
    if s.min_age_days.is_some() || s.max_age_days.is_some() {
        let Some(m)=node.modified_ms else { return false; };
        let age=now_ms.saturating_sub(m)/DAY_MS;
        if s.min_age_days.map_or(false,|v| age < v) || s.max_age_days.map_or(false,|v| age > v) { return false; }
    }
    if let Some(v)=s.sparse { if node.sparse != Some(v) { return false; } }
    if let Some(v)=s.compressed { if node.compressed != Some(v) { return false; } }
    if s.min_hard_links.map_or(false,|v| node.link_count < v) || s.max_hard_links.map_or(false,|v| node.link_count > v) { return false; }
    if let Some(v)=s.duplicate { if duplicates.contains(&node.id) != v { return false; } }
    if !lc_contains(&node.owner_hint,&s.owner_contains) || !lc_contains(&node.permissions_hint,&s.permissions_contains) { return false; }
    if s.device.map_or(false,|v| node.identity_volume != Some(v)) { return false; }
    if !s.extensions_any.is_empty() && !s.extensions_any.iter().any(|e| norm_ext(e)==norm_ext(&node.extension)) { return false; }
    if !s.categories_any.is_empty() {
        let category=category_for(node);
        if !s.categories_any.iter().any(|v| v.eq_ignore_ascii_case(category)) { return false; }
    }
    if !s.type_hints_any.is_empty() && !s.type_hints_any.iter().any(|v| matches_type_term(node, v)) { return false; }
    if !s.change_states_any.is_empty() {
        let state=changes.get(&node.id).map(String::as_str).unwrap_or("unchanged");
        if !s.change_states_any.iter().any(|v| v.eq_ignore_ascii_case(state)) { return false; }
    }
    true
}

fn matches_type_term(node:&Node, term:&str)->bool {
    let term=term.trim().to_ascii_lowercase();
    if term.is_empty() { return true; }
    let hint=node.type_hint.to_ascii_lowercase();
    if hint==term || (!hint.is_empty() && hint.contains(&term)) { return true; }
    let ext=norm_ext(&node.extension);
    if ext==term { return true; }
    let alias=match ext.as_str(){
        "rs"=>"rust", "c"=>"c", "h"=>"c", "cc"|"cpp"|"cxx"|"hpp"|"hxx"=>"c++ cpp",
        "ts"|"tsx"=>"typescript", "js"|"mjs"|"cjs"|"jsx"=>"javascript", "py"|"pyw"=>"python",
        "java"=>"java", "kt"|"kts"=>"kotlin", "go"=>"go golang", "swift"=>"swift", "cs"=>"c# csharp",
        "m"=>"objective-c matlab octave", "sh"|"bash"|"zsh"=>"shell script", "ps1"=>"powershell",
        "html"|"htm"=>"html web", "css"=>"css", "json"=>"json", "xml"=>"xml", "sql"=>"sql",
        "md"|"markdown"=>"markdown", "toml"=>"toml", "yaml"|"yml"=>"yaml", _=>""
    };
    alias.split_whitespace().any(|a| a==term) || alias.contains(&term)
}

pub fn category_for(node:&Node)->&'static str {
    if node.kind==NodeKind::Directory { return "Directory"; }
    let ext=norm_ext(&node.extension);
    // Bounded content hints override only genuinely ambiguous suffixes; ordinary
    // extensions continue to use the stable built-in category registry semantics.
    if node.type_hint.starts_with("code-") { return "Development"; }
    if matches!(node.type_hint.as_str(), "video-mpeg-ts") { return "Video"; }
    if matches!(node.type_hint.as_str(), "audio-tracker-mod") { return "Audio"; }
    if node.type_hint.starts_with("disk-image") { return "Disk images"; }
    if matches!(ext.as_str(),"jpg"|"jpeg"|"png"|"gif"|"webp"|"bmp"|"tif"|"tiff"|"svg"|"heic"|"avif") { "Images" }
    else if matches!(ext.as_str(),"mp4"|"mkv"|"avi"|"mov"|"webm"|"mpeg"|"mpg"|"ts") { "Video" }
    else if matches!(ext.as_str(),"mp3"|"flac"|"wav"|"ogg"|"opus"|"m4a"|"aac"|"mod") { "Audio" }
    else if matches!(ext.as_str(),"zip"|"7z"|"rar"|"tar"|"gz"|"xz"|"bz2"|"zst") { "Archives" }
    else if matches!(ext.as_str(),"iso"|"img"|"vhd"|"vhdx"|"vmdk"|"qcow"|"qcow2"|"raw") { "Disk images" }
    else if matches!(ext.as_str(),"rs"|"c"|"cc"|"cpp"|"cxx"|"h"|"hpp"|"py"|"js"|"ts"|"java"|"go"|"rb"|"m"|"swift"|"cs"|"sh"|"ps1") { "Development" }
    else if matches!(ext.as_str(),"pdf"|"doc"|"docx"|"odt"|"txt"|"md"|"rtf"|"xls"|"xlsx"|"ods"|"ppt"|"pptx") { "Documents" }
    else if matches!(ext.as_str(),"exe"|"msi"|"com"|"bat"|"cmd"|"appimage") { "Executables" }
    else if matches!(ext.as_str(),"dll"|"so"|"dylib"|"a"|"lib") { "Libraries" }
    else if ext.is_empty() { "Other" } else { "Other" }
}

#[derive(Debug, Clone, Serialize)]
pub struct AgeItem { pub id:NodeId, pub path:String, pub size:u64, pub allocated_size:u64, pub modified_ms:Option<u64> }
#[derive(Debug, Clone, Serialize)]
pub struct AgeDirectory { pub id:NodeId, pub path:String, pub logical_size:u64, pub allocated_size:u64, pub files:u64 }
#[derive(Debug, Clone, Serialize)]
pub struct AgeBucket { pub key:String, pub label:String, pub logical_size:u64, pub allocated_size:u64, pub files:u64, pub percentage:f64, pub largest_files:Vec<AgeItem>, pub largest_directories:Vec<AgeDirectory> }
#[derive(Debug, Clone, Serialize)]
pub struct AgeAnalysis { pub generated_ms:u64, pub total_files:u64, pub total_logical:u64, pub total_allocated:u64, pub buckets:Vec<AgeBucket> }

pub fn age_analysis(model:&ScanModel, now_ms:u64, detail_limit:usize)->AgeAnalysis {
    #[derive(Default)] struct Acc { logical:u64, allocated:u64, files:u64, file_heap:BinaryHeap<Reverse<(u64,NodeId)>>, dirs:HashMap<NodeId,(u64,u64,u64)> }
    let detail_limit=detail_limit.clamp(1,50);
    let mut acc:Vec<Acc>=(0..8).map(|_|Acc::default()).collect();
    let mut total_logical=0u64; let mut total_allocated=0u64; let mut total_files=0u64;
    for n in model.nodes.iter().filter(|n| n.active && n.kind==NodeKind::File && !n.hardlink_duplicate) {
        let idx=age_bucket_index(n.modified_ms,now_ms); let a=&mut acc[idx];
        a.logical=a.logical.saturating_add(n.size); a.allocated=a.allocated.saturating_add(n.allocated_size); a.files=a.files.saturating_add(1);
        total_logical=total_logical.saturating_add(n.size); total_allocated=total_allocated.saturating_add(n.allocated_size); total_files=total_files.saturating_add(1);
        if a.file_heap.len()<detail_limit { a.file_heap.push(Reverse((n.size,n.id))); }
        else if let Some(Reverse((smallest,_)))=a.file_heap.peek().copied() { if n.size>smallest { a.file_heap.pop();a.file_heap.push(Reverse((n.size,n.id))); } }
        if let Some(pid)=n.parent_id { let e=a.dirs.entry(pid).or_insert((0,0,0)); e.0=e.0.saturating_add(n.size); e.1=e.1.saturating_add(n.allocated_size); e.2=e.2.saturating_add(1); }
    }
    let defs=[("lt7d","< 7 days"),("7_30d","7–30 days"),("1_6m","1–6 months"),("6_12m","6–12 months"),("1_2y","1–2 years"),("2_5y","2–5 years"),("gt5y","> 5 years"),("unknown","Unknown")];
    let buckets=acc.into_iter().enumerate().map(|(i,a)|{
        let mut file_ids:Vec<_>=a.file_heap.into_iter().map(|Reverse((_,id))|id).collect(); file_ids.sort_by_key(|id|Reverse(model.nodes[*id as usize].size));
        let largest_files=file_ids.into_iter().map(|id|{let n=&model.nodes[id as usize];AgeItem{id,path:model.path_for(id),size:n.size,allocated_size:n.allocated_size,modified_ms:n.modified_ms}}).collect();
        let mut dirs:Vec<_>=a.dirs.into_iter().collect(); dirs.sort_by_key(|(_,v)|Reverse(v.0));
        let largest_directories=dirs.into_iter().take(detail_limit).map(|(id,v)|AgeDirectory{id,path:model.path_for(id),logical_size:v.0,allocated_size:v.1,files:v.2}).collect();
        AgeBucket{key:defs[i].0.into(),label:defs[i].1.into(),logical_size:a.logical,allocated_size:a.allocated,files:a.files,percentage:if total_logical==0{0.0}else{a.logical as f64*100.0/total_logical as f64},largest_files,largest_directories}
    }).collect();
    AgeAnalysis{generated_ms:now_ms,total_files,total_logical,total_allocated,buckets}
}
fn age_bucket_index(modified:Option<u64>,now:u64)->usize { let Some(m)=modified else{return 7}; let d=now.saturating_sub(m)/DAY_MS; match d {0..=6=>0,7..=29=>1,30..=182=>2,183..=364=>3,365..=729=>4,730..=1824=>5,_=>6} }

#[derive(Debug,Clone,Serialize,Deserialize)]
pub struct CleanupRules { #[serde(default="default_old_days")] pub old_days:u64, #[serde(default="default_large_bytes")] pub large_bytes:u64, #[serde(default)] pub user_paths:Vec<String>, #[serde(default)] pub include_cache_like:bool, #[serde(default="default_sparse_ratio")] pub sparse_ratio:f64, #[serde(default="default_candidate_limit")] pub limit:usize }
fn default_old_days()->u64{730} fn default_large_bytes()->u64{5*1024*1024*1024} fn default_sparse_ratio()->f64{0.25} fn default_candidate_limit()->usize{500}
impl Default for CleanupRules {fn default()->Self{Self{old_days:default_old_days(),large_bytes:default_large_bytes(),user_paths:vec![],include_cache_like:false,sparse_ratio:default_sparse_ratio(),limit:default_candidate_limit()}}}
#[derive(Debug,Clone,Serialize)] pub struct CleanupCandidate { pub id:NodeId,pub path:String,pub logical_size:u64,pub allocated_size:u64,pub modified_ms:Option<u64>,pub reasons:Vec<String> }
pub fn cleanup_candidates(model:&ScanModel,rules:&CleanupRules,duplicates:&HashSet<NodeId>,now:u64)->Vec<CleanupCandidate>{
 let limit=rules.limit.clamp(1,5000); let old_ms=rules.old_days.saturating_mul(DAY_MS);
 let mut heap:BinaryHeap<Reverse<(u64,NodeId)>>=BinaryHeap::new(); let mut details:HashMap<NodeId,(String,u64,u64,Option<u64>,Vec<String>)>=HashMap::new();
 for n in model.nodes.iter().filter(|n|n.active&&n.kind==NodeKind::File&&!n.hardlink_duplicate){let mut why=Vec::new();
  if duplicates.contains(&n.id){why.push("Confirmed byte-identical duplicate copy".into());}
  if n.size>=rules.large_bytes && n.modified_ms.map_or(false,|m|now.saturating_sub(m)>=old_ms){why.push(format!("Large file not modified for at least {} days",rules.old_days));}
  let ratio=if n.size==0{1.0}else{n.allocated_size as f64/n.size as f64}; if n.sparse==Some(true)||(n.size>=rules.large_bytes&&ratio<rules.sparse_ratio){why.push(format!("Allocation anomaly: {:.1}% allocated/logical",ratio*100.0));}
  let full_path=model.path_for(n.id);
  if !rules.user_paths.is_empty() && rules.user_paths.iter().any(|base|full_path.to_lowercase().contains(&base.to_lowercase())) && n.modified_ms.map_or(false,|m|now.saturating_sub(m)>=old_ms){why.push("Matches a user-defined stale path rule".into());}
  if rules.include_cache_like && n.size>=rules.large_bytes { let parts=full_path.to_lowercase(); if parts.split(|c| c=='/' || c=='\\').any(|part| matches!(part,"cache"|"caches"|"tmp"|"temp"|"temporary")){why.push("Large item matches the explicitly enabled cache/temp path-name rule".into());} }
  if why.is_empty(){continue;}
  let keep=if heap.len()<limit{true}else{heap.peek().map(|Reverse((smallest,_))|n.size>*smallest).unwrap_or(true)};
  if keep { if heap.len()>=limit { if let Some(Reverse((_,old_id)))=heap.pop(){details.remove(&old_id);} } heap.push(Reverse((n.size,n.id)));details.insert(n.id,(full_path,n.size,n.allocated_size,n.modified_ms,why)); }
 }
 let mut ids:Vec<_>=heap.into_iter().map(|Reverse((_,id))|id).collect();ids.sort_by_key(|id|Reverse(details.get(id).map(|x|x.1).unwrap_or(0)));
 ids.into_iter().filter_map(|id|details.remove(&id).map(|(path,logical_size,allocated_size,modified_ms,reasons)|CleanupCandidate{id,path,logical_size,allocated_size,modified_ms,reasons})).collect()
}

#[derive(Debug,Clone,Serialize)] pub struct AllocationRow {pub id:NodeId,pub path:String,pub logical_size:u64,pub allocated_size:u64,pub difference:i128,pub ratio:Option<f64>,pub sparse:Option<bool>,pub compressed:Option<bool>,pub type_hint:String}
pub fn allocation_analysis(model:&ScanModel,sort:&str,descending:bool,limit:usize)->Vec<AllocationRow>{
    let limit=limit.clamp(1,5000);
    let mut asc:BinaryHeap<(i128,NodeId)>=BinaryHeap::new();
    let mut desc:BinaryHeap<Reverse<(i128,NodeId)>>=BinaryHeap::new();
    for n in model.nodes.iter().filter(|n|n.active&&n.kind==NodeKind::File&&(n.sparse==Some(true)||n.compressed==Some(true)||n.size!=n.allocated_size)) {
        let key=allocation_key(n,sort);
        if descending {
            if desc.len()<limit { desc.push(Reverse((key,n.id))); }
            else if let Some(Reverse((smallest,_)))=desc.peek().copied() { if key>smallest { desc.pop(); desc.push(Reverse((key,n.id))); } }
        } else if asc.len()<limit { asc.push((key,n.id)); }
        else if let Some((largest,_))=asc.peek().copied() { if key<largest { asc.pop(); asc.push((key,n.id)); } }
    }
    let ids:Vec<NodeId>=if descending { desc.into_iter().map(|Reverse((_,id))|id).collect() } else { asc.into_iter().map(|(_,id)|id).collect() };
    let mut rows:Vec<_>=ids.into_iter().map(|id|allocation_row(model,&model.nodes[id as usize])).collect();
    rows.sort_by(|a,b|{let o=allocation_row_key(a,sort).cmp(&allocation_row_key(b,sort)).then_with(||a.id.cmp(&b.id));if descending{o.reverse()}else{o}});
    rows
}
fn allocation_key(n:&Node,sort:&str)->i128 { match sort {"allocated"=>n.allocated_size as i128,"difference"=>n.size as i128-n.allocated_size as i128,"ratio"=>if n.size==0{1_000_000}else{((n.allocated_size as u128*1_000_000u128)/(n.size as u128)).min(i128::MAX as u128) as i128},_=>n.size as i128} }
fn allocation_row_key(r:&AllocationRow,sort:&str)->i128 { match sort {"allocated"=>r.allocated_size as i128,"difference"=>r.difference,"ratio"=>r.ratio.map(|x|(x*1_000_000.0) as i128).unwrap_or(1_000_000),_=>r.logical_size as i128} }
fn allocation_row(model:&ScanModel,n:&Node)->AllocationRow { AllocationRow{id:n.id,path:model.path_for(n.id),logical_size:n.size,allocated_size:n.allocated_size,difference:n.size as i128-n.allocated_size as i128,ratio:if n.size==0{None}else{Some(n.allocated_size as f64/n.size as f64)},sparse:n.sparse,compressed:n.compressed,type_hint:n.type_hint.clone()} }

#[derive(Debug,Clone,Serialize)] pub struct IssueGroup {pub category:String,pub count:u64,pub affects_completeness:bool,pub paths:Vec<String>}
pub fn issues_summary(model:&ScanModel,limit_per_group:usize)->Vec<IssueGroup>{
    let mut map:HashMap<&'static str,(u64,bool,Vec<String>)>=HashMap::new();
    for e in &model.errors {
        let l=e.message.to_lowercase();
        let (cat,complete)=if l.contains("permission")||l.contains("access denied") { ("Permission denied",true) }
            else if l.contains("no such")||l.contains("not found")||l.contains("vanish") { ("Vanished during scan",true) }
            else if l.contains("symlink")||l.contains("reparse") { ("Symlink/reparse issue",false) }
            else if l.contains("metadata") { ("Metadata unavailable",true) }
            else { ("Other scan issue",false) };
        let x=map.entry(cat).or_insert((0,complete,Vec::new())); x.0=x.0.saturating_add(1);
        if x.2.len()<limit_per_group.clamp(1,100) { x.2.push(e.path.clone()); }
    }
    let mut rows:Vec<_>=map.into_iter().map(|(category,(count,affects_completeness,paths))|IssueGroup{category:category.into(),count,affects_completeness,paths}).collect();
    rows.sort_by_key(|r|Reverse(r.count)); rows
}

#[cfg(test)]
mod tests {
 use super::*;
 use crate::model::{ExtensionStat, ScanStatistics};
 use std::path::PathBuf;

 fn file_node(
     id: NodeId,
     name: &str,
     size: u64,
     alloc: u64,
     modified: Option<u64>,
     ext: &str,
     sparse: Option<bool>,
 ) -> Node {
     Node {
         id,
         parent_id: Some(0),
         active: true,
         hidden: false,
         name: name.into(),
         kind: NodeKind::File,
         size,
         allocated_size: alloc,
         raw_size: size,
         raw_allocated_size: alloc,
         identity_volume: Some(1),
         identity_index: Some(id as u64),
         modified_ms: modified,
         created_ms: modified,
         owner_hint: "uid:1".into(),
         permissions_hint: "0644".into(),
         sparse,
         compressed: Some(false),
         extension: ext.into(),
         type_hint: String::new(),
         children: vec![],
         file_count: 1,
         dir_count: 0,
         depth: 1,
         hardlink_duplicate: false,
         link_count: 1,
     }
 }

 fn model() -> ScanModel {
     let now = 10 * 365 * DAY_MS;
     let root = Node {
         id: 0,
         parent_id: None,
         active: true,
         hidden: false,
         name: "root".into(),
         kind: NodeKind::Directory,
         size: 300,
         allocated_size: 180,
         raw_size: 0,
         raw_allocated_size: 0,
         identity_volume: Some(1),
         identity_index: Some(1),
         modified_ms: Some(now),
         created_ms: None,
         owner_hint: "uid:1".into(),
         permissions_hint: "0755".into(),
         sparse: None,
         compressed: None,
         extension: String::new(),
         type_hint: String::new(),
         children: vec![1, 2],
         file_count: 2,
         dir_count: 0,
         depth: 0,
         hardlink_duplicate: false,
         link_count: 1,
     };
     ScanModel {
         root_path: PathBuf::from("/tmp/root"),
         nodes: vec![
             root,
             file_node(1, "old.bin", 200, 80, Some(now - 3 * 365 * DAY_MS), "bin", Some(true)),
             file_node(2, "new.rs", 100, 100, Some(now - 2 * DAY_MS), "rs", Some(false)),
         ],
         errors: vec![],
         error_count: 0,
         excluded_count: 0,
         extension_stats: Vec::<ExtensionStat>::new(),
         statistics: ScanStatistics::default(),
         largest: vec![],
         scanned_bytes: 300,
         allocated_bytes: 180,
         scan_elapsed_ms: 1,
         filesystem_total_bytes: None,
         filesystem_available_bytes: None,
     }
 }
 #[test]fn age_boundaries_and_unknown_are_stable(){assert_eq!(age_bucket_index(Some(100*DAY_MS-7*DAY_MS),100*DAY_MS),1);assert_eq!(age_bucket_index(None,0),7);}
 #[test]fn advanced_filters_apply_and_plus_or(){let m=model();let q=AdvancedFilterQuery{all:FilterSpec{min_logical:Some(50),kind:Some(NodeKind::File),..Default::default()},any:vec![FilterSpec{extensions_any:vec!["rs".into()],..Default::default()},FilterSpec{filename_contains:"old".into(),..Default::default()}],limit:10,..Default::default()};let r=advanced_filter(&m,&q,&HashSet::new(),&HashMap::new(),10*365*DAY_MS);assert_eq!(r.total,2);}
 #[test]fn allocation_zero_is_safe_and_sparse_is_reported(){let m=model();let r=allocation_analysis(&m,"ratio",false,10);assert_eq!(r.len(),1);assert!(r[0].ratio.unwrap()<0.5);}
 #[test]fn cleanup_is_deterministic_and_only_proposes(){let m=model();let mut d=HashSet::new();d.insert(2);let r=cleanup_candidates(&m,&CleanupRules{old_days:365,large_bytes:150,sparse_ratio:0.5,limit:10,user_paths:vec![],include_cache_like:false},&d,10*365*DAY_MS);assert_eq!(r.len(),2);assert!(r.iter().any(|x|x.reasons.iter().any(|s|s.contains("duplicate"))));}
 #[test]fn age_analysis_preserves_totals_and_unknown_bucket(){let mut m=model();m.nodes[2].modified_ms=None;m.nodes[2].created_ms=None;let a=age_analysis(&m,10*365*DAY_MS,10);assert_eq!(a.total_files,2);assert_eq!(a.total_logical,300);assert_eq!(a.total_allocated,180);let unknown=&a.buckets[7];assert_eq!(unknown.files,1);assert_eq!(unknown.logical_size,100);assert_eq!(unknown.allocated_size,100);}
 #[test]fn advanced_filter_handles_unicode_and_unknown_timestamps(){let mut m=model();m.nodes[2].name="árvíztűrő-世界.rs".into();m.nodes[2].modified_ms=None;let q=AdvancedFilterQuery{all:FilterSpec{filename_contains:"世界".into(),modified_unknown:Some(true),..Default::default()},limit:10,..Default::default()};let r=advanced_filter(&m,&q,&HashSet::new(),&HashMap::new(),10*365*DAY_MS);assert_eq!(r.total,1);assert_eq!(r.items[0].id,2);}
 #[test]fn advanced_filter_name_sort_is_global_not_scan_order(){let mut m=model();m.nodes[1].name="zeta.bin".into();m.nodes[2].name="alpha.rs".into();let q=AdvancedFilterQuery{all:FilterSpec{kind:Some(NodeKind::File),..Default::default()},sort:FilterSort::Name,descending:false,limit:1,..Default::default()};let r=advanced_filter(&m,&q,&HashSet::new(),&HashMap::new(),10*365*DAY_MS);assert_eq!(r.total,2);assert_eq!(r.items.len(),1);assert_eq!(r.items[0].name,"alpha.rs");}
 #[test]fn sparse_compressed_duplicate_and_change_filters_compose(){let mut m=model();m.nodes[1].compressed=Some(true);let mut d=HashSet::new();d.insert(1);let mut changes=HashMap::new();changes.insert(1,"changed".into());let q=AdvancedFilterQuery{all:FilterSpec{sparse:Some(true),compressed:Some(true),duplicate:Some(true),change_states_any:vec!["changed".into()],..Default::default()},limit:10,..Default::default()};let r=advanced_filter(&m,&q,&d,&changes,10*365*DAY_MS);assert_eq!(r.total,1);assert_eq!(r.items[0].id,1);}
 #[test]fn allocation_analysis_handles_zero_size_without_nan_or_divide_by_zero(){let mut m=model();m.nodes[2].size=0;m.nodes[2].allocated_size=4096;let rows=allocation_analysis(&m,"ratio",true,10);let row=rows.iter().find(|row|row.id==2).expect("zero-size allocation row");assert!(row.ratio.is_none());}
 #[test]fn cleanup_limit_is_bounded_and_keeps_largest_candidates(){let mut m=model();let template=m.nodes[2].clone();m.nodes.truncate(1);m.nodes[0].children.clear();for id in 1..=25u32{let mut n=template.clone();n.id=id;n.parent_id=Some(0);n.name=format!("old-{id}.bin");n.size=id as u64*100;n.allocated_size=n.size;n.modified_ms=Some(DAY_MS);n.created_ms=n.modified_ms;n.extension="bin".into();m.nodes.push(n);m.nodes[0].children.push(id);}let r=cleanup_candidates(&m,&CleanupRules{old_days:1,large_bytes:1,sparse_ratio:0.1,limit:5,user_paths:vec![],include_cache_like:false},&HashSet::new(),10*365*DAY_MS);assert_eq!(r.len(),5);assert_eq!(r[0].logical_size,2500);assert_eq!(r[4].logical_size,2100);}
}
