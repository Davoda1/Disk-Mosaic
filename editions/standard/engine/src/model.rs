use serde::{Deserialize, Serialize};
use std::cmp::{Ordering, Reverse};
use std::collections::{BinaryHeap, HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

pub type NodeId = u32;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "snake_case")]
pub enum NodeKind {
    Directory,
    File,
    Symlink,
    Other,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Node {
    pub id: NodeId,
    pub parent_id: Option<NodeId>,
    #[serde(default = "default_true")]
    pub active: bool,
    #[serde(default)]
    pub hidden: bool,
    pub name: String,
    pub kind: NodeKind,
    pub size: u64,
    pub allocated_size: u64,
    /// Original per-entry sizes before hard-link de-duplication. These fields let
    /// incremental refresh re-evaluate hard-link accounting without re-statting
    /// every unchanged file in the model.
    #[serde(default)]
    pub raw_size: u64,
    #[serde(default)]
    pub raw_allocated_size: u64,
    #[serde(default)]
    pub identity_volume: Option<u64>,
    #[serde(default)]
    pub identity_index: Option<u64>,
    pub modified_ms: Option<u64>,
    /// Creation/birth timestamp when the host filesystem exposes it cheaply.
    #[serde(default)]
    pub created_ms: Option<u64>,
    /// Lightweight owner/permission hints captured from the same metadata call used by scanning.
    /// Empty means unavailable on this platform/filesystem.
    #[serde(default)]
    pub owner_hint: String,
    #[serde(default)]
    pub permissions_hint: String,
    /// Filesystem-provided allocation attributes. `None` means not known/supported.
    #[serde(default)]
    pub sparse: Option<bool>,
    #[serde(default)]
    pub compressed: Option<bool>,
    pub extension: String,
    /// Lightweight local classification used primarily for extensionless or ambiguous files.
    /// Empty means the filename extension is sufficient.
    #[serde(default)]
    pub type_hint: String,
    pub children: Vec<NodeId>,
    pub file_count: u64,
    pub dir_count: u64,
    pub depth: u32,
    pub hardlink_duplicate: bool,
    pub link_count: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanError {
    pub path: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtensionStat {
    pub extension: String,
    pub files: u64,
    pub size: u64,
    pub allocated_size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DistributionBucket {
    pub label: String,
    pub files: u64,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ScanStatistics {
    pub size_buckets: Vec<DistributionBucket>,
    pub age_buckets: Vec<DistributionBucket>,
    pub max_depth: u32,
    pub hardlink_duplicates: u64,
    pub extensionless_files: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct NodeSummary {
    pub id: NodeId,
    pub parent_id: Option<NodeId>,
    pub name: String,
    pub path: String,
    pub kind: NodeKind,
    pub hidden: bool,
    pub size: u64,
    pub allocated_size: u64,
    pub modified_ms: Option<u64>,
    pub created_ms: Option<u64>,
    pub owner_hint: String,
    pub permissions_hint: String,
    pub sparse: Option<bool>,
    pub compressed: Option<bool>,
    pub identity_volume: Option<u64>,
    pub identity_index: Option<u64>,
    pub extension: String,
    pub type_hint: String,
    pub file_count: u64,
    pub dir_count: u64,
    pub hardlink_duplicate: bool,
    pub link_count: u64,
}

fn default_true() -> bool { true }

#[derive(Debug, Clone, Serialize)]
pub struct TreemapItem {
    pub id: Option<NodeId>,
    pub parent_id: Option<NodeId>,
    pub name: String,
    pub path: String,
    pub kind: String,
    /// The value used for layout in the requested size basis.
    pub size: u64,
    pub logical_size: u64,
    pub allocated_size: u64,
    pub modified_ms: Option<u64>,
    pub extension: String,
    pub type_hint: String,
    pub aggregated_items: u64,
    pub file_count: u64,
    pub dir_count: u64,
    /// True when this tile (or directory subtree / aggregate remainder) contains
    /// at least one file matching the optional treemap type filter.
    pub matches_filter: bool,
}

#[derive(Debug, Clone, Serialize, Default)]
pub struct SelectionSummary {
    pub selected_items: usize,
    pub effective_items: usize,
    pub logical_size: u64,
    pub allocated_size: u64,
    pub files: u64,
    pub directories: u64,
}

#[derive(Debug, Clone, Serialize, Default)]
pub struct RefreshReport {
    pub target_id: NodeId,
    pub target_path: String,
    pub reused_ids: usize,
    pub new_ids: usize,
    pub removed_ids: usize,
    pub active_nodes: usize,
}

#[derive(Debug, Clone, Copy)]
pub enum SortField {
    Name,
    Size,
    Allocated,
    Files,
    Directories,
    Modified,
    Owner,
    Permissions,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SizeBasis { Logical, Allocated }

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum HiddenMode { ShowAll, DirectoriesOnly, HideAll }

impl Default for HiddenMode {
    fn default() -> Self { Self::ShowAll }
}

impl HiddenMode {
    pub fn parse(value: Option<&str>) -> Self {
        match value.unwrap_or("show_all") {
            "directories_only" | "only_directories" => Self::DirectoriesOnly,
            "hide_all" => Self::HideAll,
            _ => Self::ShowAll,
        }
    }
}

impl SizeBasis {
    pub fn parse(value: Option<&str>) -> Self {
        match value { Some("allocated") => Self::Allocated, _ => Self::Logical }
    }
}

impl SortField {
    pub fn parse(value: Option<&str>) -> Self {
        match value {
            Some("name") => Self::Name,
            Some("allocated") => Self::Allocated,
            Some("files") => Self::Files,
            Some("directories") => Self::Directories,
            Some("modified") => Self::Modified,
            Some("owner") => Self::Owner,
            Some("permissions") => Self::Permissions,
            _ => Self::Size,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanModel {
    pub root_path: PathBuf,
    pub nodes: Vec<Node>,
    pub errors: Vec<ScanError>,
    pub error_count: u64,
    pub excluded_count: u64,
    pub extension_stats: Vec<ExtensionStat>,
    pub statistics: ScanStatistics,
    pub largest: Vec<NodeId>,
    pub scanned_bytes: u64,
    pub allocated_bytes: u64,
    pub scan_elapsed_ms: u64,
    pub filesystem_total_bytes: Option<u64>,
    pub filesystem_available_bytes: Option<u64>,
}

impl ScanModel {
    /// Validate persisted arenas before any path reconstruction or traversal. A
    /// snapshot is an external input; serde alone cannot enforce tree invariants.
    pub fn validate_structure(&self) -> Result<(), String> {
        let Some(root) = self.nodes.first() else {
            return Err("Scan data has no root node".to_string());
        };
        if self.root_path.as_os_str().is_empty() || !root.active
            || root.kind != NodeKind::Directory || root.parent_id.is_some() || root.depth != 0
        {
            return Err("Scan data has an invalid root node".to_string());
        }
        for (index, node) in self.nodes.iter().enumerate() {
            if node.id as usize != index {
                return Err(format!("Scan data has a non-contiguous node ID at {index}"));
            }
            if node.parent_id.is_some_and(|parent| parent as usize >= self.nodes.len() || parent == node.id)
                || node.children.iter().any(|child| *child as usize >= self.nodes.len())
            {
                return Err(format!("Scan node {index} has an invalid node reference"));
            }
            if !node.active { continue; }
            if index != 0 {
                // Each entry is one native filename, never a path that can
                // replace or escape the stored root during PathBuf::push.
                let mut components = Path::new(&node.name).components();
                if node.name.contains('\0') || node.name.contains('/')
                    || (cfg!(windows) && node.name.contains('\\'))
                    || !matches!(components.next(), Some(std::path::Component::Normal(_)))
                    || components.next().is_some()
                {
                    return Err(format!("Scan node {index} has an invalid filename"));
                }
                let parent = node.parent_id.and_then(|id| self.nodes.get(id as usize))
                    .ok_or_else(|| format!("Scan node {index} has no parent"))?;
                if !parent.active || parent.kind != NodeKind::Directory
                    || parent.depth.checked_add(1) != Some(node.depth)
                {
                    return Err(format!("Scan node {index} has an invalid parent or depth"));
                }
            }
            if node.kind != NodeKind::Directory && !node.children.is_empty() {
                return Err(format!("Non-directory scan node {index} has children"));
            }
        }

        let mut seen = vec![false; self.nodes.len()];
        let mut stack = vec![0u32];
        while let Some(id) = stack.pop() {
            if seen[id as usize] {
                return Err(format!("Scan data contains a cycle or repeated child at node {id}"));
            }
            seen[id as usize] = true;
            for child_id in &self.nodes[id as usize].children {
                let child = &self.nodes[*child_id as usize];
                if !child.active { continue; }
                if child.parent_id != Some(id) {
                    return Err(format!("Scan node {child_id} has inconsistent parent/child links"));
                }
                stack.push(*child_id);
            }
        }
        if self.nodes.iter().any(|node| node.active && !seen[node.id as usize]) {
            return Err("Scan data contains an unreachable active node".to_string());
        }
        Ok(())
    }

    pub fn visibility_mask(&self, mode: HiddenMode) -> Vec<bool> {
        if mode == HiddenMode::ShowAll {
            return self.nodes.iter().map(|node| node.active).collect();
        }
        let mut visible = vec![false; self.nodes.len()];
        for (index, node) in self.nodes.iter().enumerate() {
            if !node.active { continue; }
            if index == 0 {
                visible[index] = true;
                continue;
            }
            visible[index] = match mode {
                HiddenMode::ShowAll => true,
                HiddenMode::DirectoriesOnly => !node.hidden || node.kind == NodeKind::Directory,
                HiddenMode::HideAll => {
                    let parent_visible = node.parent_id
                        .and_then(|id| visible.get(id as usize).copied())
                        .unwrap_or(true);
                    parent_visible && !node.hidden
                }
            };
        }
        visible
    }

    pub fn path_for(&self, id: NodeId) -> String {
        if self.nodes.get(id as usize).is_none() { return String::new(); }
        if id == 0 {
            return self.root_path.to_string_lossy().into_owned();
        }
        let mut parts: Vec<&str> = Vec::new();
        let mut current = Some(id);
        while let Some(node_id) = current {
            let node = &self.nodes[node_id as usize];
            if node_id != 0 {
                parts.push(node.name.as_str());
            }
            current = node.parent_id;
        }
        let mut path = self.root_path.clone();
        for part in parts.iter().rev() {
            path.push(part);
        }
        path.to_string_lossy().into_owned()
    }

    pub fn relative_path_for(&self, id: NodeId) -> String {
        if id == 0 { return String::new(); }
        let mut parts: Vec<&str> = Vec::new();
        let mut current = Some(id);
        while let Some(node_id) = current {
            let node = &self.nodes[node_id as usize];
            if node_id != 0 { parts.push(node.name.as_str()); }
            current = node.parent_id;
        }
        parts.reverse();
        parts.join("/")
    }

    pub fn node_summary(&self, id: NodeId) -> Option<NodeSummary> {
        let node = self.nodes.get(id as usize)?;
        if !node.active { return None; }
        Some(NodeSummary {
            id: node.id,
            parent_id: node.parent_id,
            name: node.name.clone(),
            path: self.path_for(id),
            kind: node.kind,
            hidden: node.hidden,
            size: node.size,
            allocated_size: node.allocated_size,
            modified_ms: node.modified_ms,
            created_ms: node.created_ms,
            owner_hint: node.owner_hint.clone(),
            permissions_hint: node.permissions_hint.clone(),
            sparse: node.sparse,
            compressed: node.compressed,
            identity_volume: node.identity_volume,
            identity_index: node.identity_index,
            extension: node.extension.clone(),
            type_hint: node.type_hint.clone(),
            file_count: node.file_count,
            dir_count: node.dir_count,
            hardlink_duplicate: node.hardlink_duplicate,
            link_count: node.link_count,
        })
    }

    pub fn ancestors(&self, id: NodeId) -> Vec<NodeSummary> {
        if self.nodes.get(id as usize).is_none_or(|node| !node.active) { return Vec::new(); }
        let mut ids = Vec::new();
        let mut current = Some(id);
        while let Some(node_id) = current {
            ids.push(node_id);
            current = self.nodes[node_id as usize].parent_id;
        }
        ids.reverse();
        ids.into_iter().filter_map(|node_id| self.node_summary(node_id)).collect()
    }

    pub fn children(
        &self,
        parent_id: NodeId,
        offset: usize,
        limit: usize,
        sort: SortField,
        descending: bool,
    ) -> (usize, Vec<NodeSummary>) {
        self.children_visible(parent_id, offset, limit, sort, descending, HiddenMode::ShowAll)
    }

    pub fn children_visible(
        &self,
        parent_id: NodeId,
        offset: usize,
        limit: usize,
        sort: SortField,
        descending: bool,
        hidden_mode: HiddenMode,
    ) -> (usize, Vec<NodeSummary>) {
        let Some(parent) = self.nodes.get(parent_id as usize) else {
            return (0, Vec::new());
        };
        if !parent.active { return (0, Vec::new()); }
        let visible = self.visibility_mask(hidden_mode);
        if !visible.get(parent_id as usize).copied().unwrap_or(false) { return (0, Vec::new()); }
        let mut ids: Vec<NodeId> = parent.children.iter().copied()
            .filter(|id| visible.get(*id as usize).copied().unwrap_or(false))
            .collect();
        ids.sort_by(|a, b| {
            let na = &self.nodes[*a as usize];
            let nb = &self.nodes[*b as usize];
            let ord = match sort {
                SortField::Name => na.name.to_lowercase().cmp(&nb.name.to_lowercase()),
                SortField::Size => na.size.cmp(&nb.size),
                SortField::Allocated => na.allocated_size.cmp(&nb.allocated_size),
                SortField::Files => na.file_count.cmp(&nb.file_count),
                SortField::Directories => na.dir_count.cmp(&nb.dir_count),
                SortField::Modified => na.modified_ms.cmp(&nb.modified_ms),
                SortField::Owner => na.owner_hint.to_lowercase().cmp(&nb.owner_hint.to_lowercase()),
                SortField::Permissions => na.permissions_hint.cmp(&nb.permissions_hint),
            };
            let ord = if ord == Ordering::Equal { na.name.cmp(&nb.name) } else { ord };
            if descending { ord.reverse() } else { ord }
        });
        let total = ids.len();
        let out = ids
            .into_iter()
            .skip(offset)
            .take(limit)
            .filter_map(|id| self.node_summary(id))
            .collect();
        (total, out)
    }

    pub fn search(
        &self,
        name_contains: Option<&str>,
        path_contains: Option<&str>,
        extension: Option<&str>,
        min_size: Option<u64>,
        max_size: Option<u64>,
        kind: Option<NodeKind>,
        modified_before_ms: Option<u64>,
        modified_after_ms: Option<u64>,
        basis: SizeBasis,
        limit: usize,
    ) -> Vec<NodeSummary> {
        self.search_visible(
            name_contains, path_contains, extension, min_size, max_size, kind,
            modified_before_ms, modified_after_ms, basis, limit, HiddenMode::ShowAll,
        )
    }

    pub fn search_visible(
        &self,
        name_contains: Option<&str>,
        path_contains: Option<&str>,
        extension: Option<&str>,
        min_size: Option<u64>,
        max_size: Option<u64>,
        kind: Option<NodeKind>,
        modified_before_ms: Option<u64>,
        modified_after_ms: Option<u64>,
        basis: SizeBasis,
        limit: usize,
        hidden_mode: HiddenMode,
    ) -> Vec<NodeSummary> {
        let name_q = name_contains.map(|s| s.to_lowercase());
        let path_q = path_contains.map(|s| s.to_lowercase());
        let ext_q = extension.map(normalize_extension);
        let limit = limit.max(1);
        let visible = self.visibility_mask(hidden_mode);

        // Search every node, but keep only the largest `limit` matches. This avoids
        // returning whichever matches happened to have the lowest arena IDs while
        // also keeping memory bounded for scans with millions of matching entries.
        let mut matches: BinaryHeap<(Reverse<u64>, NodeId)> =
            BinaryHeap::with_capacity(limit.saturating_add(1));

        for node in &self.nodes {
            if !node.active || !visible.get(node.id as usize).copied().unwrap_or(false) { continue; }
            if min_size.is_some_and(|v| self.size_for(node, basis) < v) { continue; }
            if max_size.is_some_and(|v| self.size_for(node, basis) > v) { continue; }
            if kind.is_some_and(|v| node.kind != v) { continue; }
            if modified_before_ms.is_some_and(|v| node.modified_ms.is_none_or(|m| m >= v)) { continue; }
            if modified_after_ms.is_some_and(|v| node.modified_ms.is_none_or(|m| m <= v)) { continue; }
            if let Some(ref q) = name_q {
                if !node.name.to_lowercase().contains(q) { continue; }
            }
            if let Some(ref q) = ext_q {
                if node.extension != *q { continue; }
            }
            if let Some(ref q) = path_q {
                if !self.path_for(node.id).to_lowercase().contains(q) { continue; }
            }

            if matches.len() < limit {
                matches.push((Reverse(self.size_for(node, basis)), node.id));
            } else if matches.peek().map(|entry| self.size_for(node, basis) > (entry.0).0).unwrap_or(false) {
                matches.pop();
                matches.push((Reverse(self.size_for(node, basis)), node.id));
            }
        }

        let mut ids: Vec<NodeId> = matches.into_iter().map(|(_, id)| id).collect();
        ids.sort_by(|a, b| {
            let a_node = &self.nodes[*a as usize];
            let b_node = &self.nodes[*b as usize];
            self.size_for(b_node, basis).cmp(&self.size_for(a_node, basis)).then_with(|| a_node.name.cmp(&b_node.name))
        });
        ids.into_iter().filter_map(|id| self.node_summary(id)).collect()
    }

    pub fn largest_files(&self, limit: usize, basis: SizeBasis) -> Vec<NodeSummary> {
        self.largest_files_visible(limit, basis, HiddenMode::ShowAll)
    }

    pub fn largest_files_visible(&self, limit: usize, basis: SizeBasis, hidden_mode: HiddenMode) -> Vec<NodeSummary> {
        let limit = limit.clamp(1, 1000);
        let visible = self.visibility_mask(hidden_mode);
        if basis == SizeBasis::Logical && hidden_mode == HiddenMode::ShowAll {
            return self.largest
                .iter()
                .copied()
                .take(limit.min(self.largest.len()))
                .filter_map(|id| self.node_summary(id))
                .collect();
        }

        // When allocated-size ranking or a hidden-entry visibility filter is active,
        // compute an independent bounded top-K so hidden rows cannot consume the page.
        let mut heap: BinaryHeap<(Reverse<u64>, NodeId)> = BinaryHeap::with_capacity(limit + 1);
        for node in &self.nodes {
            if !node.active || node.kind != NodeKind::File || !visible.get(node.id as usize).copied().unwrap_or(false) { continue; }
            let value = self.size_for(node, basis);
            if heap.len() < limit {
                heap.push((Reverse(value), node.id));
            } else if heap.peek().map(|entry| value > (entry.0).0).unwrap_or(false) {
                heap.pop();
                heap.push((Reverse(value), node.id));
            }
        }
        let mut ids: Vec<NodeId> = heap.into_iter().map(|(_, id)| id).collect();
        ids.sort_by(|a, b| self.size_for(&self.nodes[*b as usize], basis)
            .cmp(&self.size_for(&self.nodes[*a as usize], basis))
            .then_with(|| self.nodes[*a as usize].name.cmp(&self.nodes[*b as usize].name)));
        ids.into_iter().filter_map(|id| self.node_summary(id)).collect()
    }

    pub fn treemap(
        &self,
        parent_id: NodeId,
        max_items: usize,
        min_bytes: u64,
        basis: SizeBasis,
        filter_extensions: &[String],
    ) -> Vec<TreemapItem> {
        self.treemap_visible(parent_id, max_items, min_bytes, basis, filter_extensions, HiddenMode::ShowAll)
    }

    pub fn treemap_visible(
        &self,
        parent_id: NodeId,
        max_items: usize,
        min_bytes: u64,
        basis: SizeBasis,
        filter_extensions: &[String],
        hidden_mode: HiddenMode,
    ) -> Vec<TreemapItem> {
        let Some(parent) = self.nodes.get(parent_id as usize) else { return Vec::new(); };
        if !parent.active || parent.kind != NodeKind::Directory { return Vec::new(); }
        let visible = self.visibility_mask(hidden_mode);
        if !visible.get(parent_id as usize).copied().unwrap_or(false) { return Vec::new(); }

        // Type highlighting is computed in Rust so directory and synthetic
        // remainder tiles can be highlighted based on their entire subtree, not
        // merely on whichever leaf rectangles happen to be visible in Electron.
        // This is an on-demand O(n) in-memory pass only when a filter is active.
        let wanted: HashSet<String> = filter_extensions.iter()
            .map(|value| normalize_extension(value))
            .collect();
        let filter_matches = if wanted.is_empty() {
            None
        } else {
            let mut matches = vec![false; self.nodes.len()];
            for index in (0..self.nodes.len()).rev() {
                let node = &self.nodes[index];
                if !node.active { continue; }
                let own_match = node.kind == NodeKind::File && wanted.contains(&node.extension);
                let child_match = node.children.iter()
                    .any(|child_id| matches.get(*child_id as usize).copied().unwrap_or(false));
                matches[index] = own_match || child_match;
            }
            Some(matches)
        };

        // Return a bounded, pruned hierarchy instead of a flat list of the globally
        // largest files.  Every expanded directory is partitioned into real direct
        // children plus (when needed) one synthetic remainder node.  Therefore the
        // direct children of each directory always add up to that directory's size,
        // which lets the renderer preserve true area ratios all the way from the scan
        // root down to individual files.
        const MAX_CHILDREN_PER_DIRECTORY: usize = 96;
        let max_items = max_items.max(1);
        let mut items = Vec::with_capacity(max_items);
        let mut expand: BinaryHeap<(u64, Reverse<NodeId>)> = BinaryHeap::new();
        expand.push((self.size_for(parent, basis), Reverse(parent_id)));

        while let Some((_directory_size, Reverse(directory_id))) = expand.pop() {
            if items.len() >= max_items { break; }
            let directory = &self.nodes[directory_id as usize];
            if !directory.active || directory.kind != NodeKind::Directory { continue; }

            let remaining_budget = max_items.saturating_sub(items.len());
            if remaining_budget == 0 { break; }

            // Leave room for a remainder rectangle whenever this directory has more
            // children than we can expose.  A min-heap keeps only the largest direct
            // children without sorting huge directories in full.
            let detail_capacity = MAX_CHILDREN_PER_DIRECTORY
                .min(remaining_budget.saturating_sub(1));
            let mut top: BinaryHeap<(Reverse<u64>, NodeId)> =
                BinaryHeap::with_capacity(detail_capacity.saturating_add(1));
            let mut total_size = 0u64;
            let mut total_logical = 0u64;
            let mut total_allocated = 0u64;
            let mut total_objects = 0u64;

            for &child_id in &directory.children {
                let child = &self.nodes[child_id as usize];
                if !child.active { continue; }
                let child_value = self.size_for(child, basis);
                if child_value == 0 { continue; }
                total_size = total_size.saturating_add(child_value);
                total_logical = total_logical.saturating_add(child.size);
                total_allocated = total_allocated.saturating_add(child.allocated_size);
                total_objects = total_objects.saturating_add(match child.kind {
                    NodeKind::Directory => child.file_count
                        .saturating_add(child.dir_count)
                        .saturating_add(1),
                    _ => 1,
                });

                if !visible.get(child_id as usize).copied().unwrap_or(false) { continue; }
                if child_value < min_bytes || detail_capacity == 0 { continue; }
                if top.len() < detail_capacity {
                    top.push((Reverse(child_value), child_id));
                } else if top.peek().map(|entry| child_value > (entry.0).0).unwrap_or(false) {
                    top.pop();
                    top.push((Reverse(child_value), child_id));
                }
            }

            let mut selected: Vec<NodeId> = top.into_iter().map(|(_, id)| id).collect();
            selected.sort_by_key(|id| Reverse(self.size_for(&self.nodes[*id as usize], basis)));

            let mut selected_size = 0u64;
            let mut selected_logical = 0u64;
            let mut selected_allocated = 0u64;
            let mut selected_objects = 0u64;
            for child_id in selected {
                if items.len() >= max_items { break; }
                let child = &self.nodes[child_id as usize];
                let child_value = self.size_for(child, basis);
                selected_size = selected_size.saturating_add(child_value);
                selected_logical = selected_logical.saturating_add(child.size);
                selected_allocated = selected_allocated.saturating_add(child.allocated_size);
                selected_objects = selected_objects.saturating_add(match child.kind {
                    NodeKind::Directory => child.file_count
                        .saturating_add(child.dir_count)
                        .saturating_add(1),
                    _ => 1,
                });
                let kind = match child.kind {
                    NodeKind::Directory => "directory",
                    NodeKind::File => "file",
                    NodeKind::Symlink => "symlink",
                    NodeKind::Other => "other",
                };
                items.push(TreemapItem {
                    id: Some(child_id),
                    parent_id: Some(directory_id),
                    name: child.name.clone(),
                    path: self.path_for(child_id),
                    kind: kind.to_string(),
                    size: child_value,
                    logical_size: child.size,
                    allocated_size: child.allocated_size,
                    modified_ms: child.modified_ms,
                    extension: child.extension.clone(),
                    type_hint: child.type_hint.clone(),
                    aggregated_items: 1,
                    file_count: child.file_count,
                    dir_count: child.dir_count,
                    matches_filter: filter_matches.as_ref()
                        .map(|matches| matches.get(child_id as usize).copied().unwrap_or(false))
                        .unwrap_or(true),
                });
                if child.kind == NodeKind::Directory && child_value > 0 {
                    expand.push((child_value, Reverse(child_id)));
                }
            }

            let selected_ids: HashSet<NodeId> = items.iter()
                .rev()
                .take_while(|item| item.parent_id == Some(directory_id))
                .filter_map(|item| item.id)
                .collect();
            let remainder_matches_filter = filter_matches.as_ref().map(|matches| {
                directory.children.iter().any(|child_id| {
                    !selected_ids.contains(child_id)
                        && self.nodes.get(*child_id as usize).is_some_and(|node| node.active)
                        && self.size_for(&self.nodes[*child_id as usize], basis) > 0
                        && matches.get(*child_id as usize).copied().unwrap_or(false)
                })
            }).unwrap_or(true);

            let remainder_size = total_size.saturating_sub(selected_size);
            let remainder_logical = total_logical.saturating_sub(selected_logical);
            let remainder_allocated = total_allocated.saturating_sub(selected_allocated);
            let remainder_objects = total_objects.saturating_sub(selected_objects);
            if remainder_size > 0 && items.len() < max_items {
                items.push(TreemapItem {
                    id: None,
                    parent_id: Some(directory_id),
                    name: format!("Other items ({remainder_objects})"),
                    path: self.path_for(directory_id),
                    kind: "aggregate".to_string(),
                    size: remainder_size,
                    logical_size: remainder_logical,
                    allocated_size: remainder_allocated,
                    modified_ms: None,
                    extension: String::new(),
                    type_hint: String::new(),
                    aggregated_items: remainder_objects,
                    file_count: 0,
                    dir_count: 0,
                    matches_filter: remainder_matches_filter,
                });
            }
        }

        items
    }

    pub fn size_for(&self, node: &Node, basis: SizeBasis) -> u64 {
        match basis { SizeBasis::Logical => node.size, SizeBasis::Allocated => node.allocated_size }
    }

    pub fn root_size(&self, basis: SizeBasis) -> u64 {
        self.nodes.first().filter(|node| node.active).map(|node| self.size_for(node, basis)).unwrap_or(0)
    }

    pub fn active_node_count(&self) -> usize {
        self.nodes.iter().filter(|node| node.active).count()
    }

    pub fn find_by_path(&self, path: &Path) -> Option<NodeId> {
        self.nodes.iter()
            .filter(|node| node.active)
            .find(|node| PathBuf::from(self.path_for(node.id)) == path)
            .map(|node| node.id)
    }

    /// Remove duplicate/invalid selections and suppress descendants when one of
    /// their ancestors is already selected. This is used for aggregate metrics
    /// and destructive batch operations so overlapping selections are not counted
    /// or acted on twice.
    pub fn normalized_selection(&self, ids: &[NodeId]) -> Vec<NodeId> {
        let mut unique: HashSet<NodeId> = ids.iter().copied()
            .filter(|id| self.nodes.get(*id as usize).is_some_and(|node| node.active))
            .collect();
        let mut ordered: Vec<NodeId> = unique.iter().copied().collect();
        ordered.sort_by_key(|id| (self.nodes[*id as usize].depth, *id));
        let mut effective = Vec::with_capacity(ordered.len());
        for id in ordered {
            let mut current = self.nodes[id as usize].parent_id;
            let mut shadowed = false;
            while let Some(parent_id) = current {
                if unique.contains(&parent_id) {
                    shadowed = true;
                    break;
                }
                current = self.nodes.get(parent_id as usize).and_then(|node| node.parent_id);
            }
            if !shadowed { effective.push(id); }
        }
        unique.clear();
        effective
    }

    pub fn selection_summary(&self, ids: &[NodeId]) -> SelectionSummary {
        let selected_items = ids.iter().copied().collect::<HashSet<_>>().into_iter()
            .filter(|id| self.nodes.get(*id as usize).is_some_and(|node| node.active))
            .count();
        let effective = self.normalized_selection(ids);
        let mut summary = SelectionSummary { selected_items, effective_items: effective.len(), ..SelectionSummary::default() };
        for id in effective {
            let node = &self.nodes[id as usize];
            summary.logical_size = summary.logical_size.saturating_add(node.size);
            summary.allocated_size = summary.allocated_size.saturating_add(node.allocated_size);
            match node.kind {
                NodeKind::Directory => {
                    summary.files = summary.files.saturating_add(node.file_count);
                    summary.directories = summary.directories.saturating_add(node.dir_count.saturating_add(1));
                }
                NodeKind::File => summary.files = summary.files.saturating_add(1),
                _ => {}
            }
        }
        summary
    }

    /// Merge a freshly scanned subtree into this model while retaining IDs for
    /// entries that still exist at the same scan-relative path. Deleted nodes
    /// become inactive tombstones so renderer-held IDs can never accidentally
    /// refer to a different filesystem entry later.
    pub fn reconcile_subtree(
        &mut self,
        target_id: NodeId,
        fresh: &ScanModel,
        deduplicate_hardlinks: bool,
    ) -> Result<RefreshReport, String> {
        let target = self.nodes.get(target_id as usize)
            .filter(|node| node.active)
            .cloned()
            .ok_or_else(|| "Refresh target is no longer present in the model".to_string())?;
        if target.kind != NodeKind::Directory {
            return Err("Incremental refresh target must be a directory".to_string());
        }
        if fresh.nodes.first().is_none_or(|node| !node.active || node.kind != NodeKind::Directory) {
            return Err("Refreshed subtree did not contain a directory root".to_string());
        }

        let target_path = self.path_for(target_id);
        let target_path_buf = PathBuf::from(&target_path);
        let mut old_by_relative: HashMap<String, NodeId> = HashMap::new();
        let mut old_subtree = Vec::new();
        let mut stack = vec![(target_id, String::new())];
        while let Some((id, relative)) = stack.pop() {
            let Some(node) = self.nodes.get(id as usize) else { continue; };
            if !node.active { continue; }
            old_by_relative.insert(relative.clone(), id);
            old_subtree.push(id);
            for child_id in node.children.iter().copied() {
                let Some(child) = self.nodes.get(child_id as usize) else { continue; };
                if !child.active { continue; }
                let child_relative = if relative.is_empty() {
                    child.name.clone()
                } else {
                    format!("{relative}/{}", child.name)
                };
                stack.push((child_id, child_relative));
            }
        }

        let mut final_ids = vec![0u32; fresh.nodes.len()];
        let mut reused = HashSet::new();
        let mut new_ids = 0usize;
        for fresh_node in &fresh.nodes {
            if !fresh_node.active { continue; }
            let relative = fresh.relative_path_for(fresh_node.id);
            let final_id = if fresh_node.id == 0 {
                target_id
            } else if let Some(existing) = old_by_relative.get(&relative).copied() {
                existing
            } else {
                let id = u32::try_from(self.nodes.len())
                    .map_err(|_| "Filesystem model exceeded the supported node-ID range".to_string())?;
                let mut placeholder = fresh_node.clone();
                placeholder.id = id;
                placeholder.active = false;
                placeholder.children.clear();
                self.nodes.push(placeholder);
                new_ids = new_ids.saturating_add(1);
                id
            };
            if let Some(slot) = final_ids.get_mut(fresh_node.id as usize) { *slot = final_id; }
            reused.insert(final_id);
        }

        let removed_ids: Vec<NodeId> = old_subtree.iter().copied().filter(|id| !reused.contains(id)).collect();
        for id in &removed_ids {
            if let Some(node) = self.nodes.get_mut(*id as usize) {
                node.active = false;
                node.children.clear();
            }
        }

        for fresh_node in &fresh.nodes {
            if !fresh_node.active { continue; }
            let final_id = final_ids[fresh_node.id as usize];
            let mut merged = fresh_node.clone();
            merged.id = final_id;
            merged.active = true;
            merged.depth = target.depth.saturating_add(fresh_node.depth);
            merged.parent_id = if fresh_node.id == 0 {
                target.parent_id
            } else {
                fresh_node.parent_id.and_then(|parent| final_ids.get(parent as usize).copied())
            };
            merged.children = fresh_node.children.iter()
                .filter_map(|child| final_ids.get(*child as usize).copied())
                .collect();
            if fresh_node.id == 0 {
                // The arena ID/path identity of the selected directory is stable;
                // retain its display name even on platforms with unusual root names.
                merged.name = target.name.clone();
            }
            self.nodes[final_id as usize] = merged;
        }

        let old_stored_errors = self.errors.iter()
            .filter(|error| PathBuf::from(&error.path).starts_with(&target_path_buf))
            .count() as u64;
        self.errors.retain(|error| !PathBuf::from(&error.path).starts_with(&target_path_buf));
        let remaining_error_capacity = 10_000usize.saturating_sub(self.errors.len());
        self.errors.extend(fresh.errors.iter().take(remaining_error_capacity).cloned());
        if target_id == 0 {
            self.error_count = fresh.error_count;
            self.excluded_count = fresh.excluded_count;
            self.filesystem_total_bytes = fresh.filesystem_total_bytes;
            self.filesystem_available_bytes = fresh.filesystem_available_bytes;
        } else {
            self.error_count = self.error_count.saturating_sub(old_stored_errors).saturating_add(fresh.error_count);
        }
        self.scan_elapsed_ms = self.scan_elapsed_ms.saturating_add(fresh.scan_elapsed_ms);

        self.normalize_hardlinks(deduplicate_hardlinks);
        self.recompute_aggregates();
        self.build_indexes();

        Ok(RefreshReport {
            target_id,
            target_path,
            reused_ids: reused.len().saturating_sub(new_ids),
            new_ids,
            removed_ids: removed_ids.len(),
            active_nodes: self.active_node_count(),
        })
    }

    pub fn normalize_hardlinks(&mut self, deduplicate: bool) {
        let mut seen: HashSet<(u64, u64)> = HashSet::new();
        for node in &mut self.nodes {
            if !node.active || node.kind != NodeKind::File { continue; }
            if node.raw_size == 0 && node.size > 0 { node.raw_size = node.size; }
            if node.raw_allocated_size == 0 && node.allocated_size > 0 { node.raw_allocated_size = node.allocated_size; }
            node.size = node.raw_size;
            node.allocated_size = node.raw_allocated_size;
            node.hardlink_duplicate = false;
            if deduplicate && node.link_count > 1 {
                if let (Some(volume), Some(index)) = (node.identity_volume, node.identity_index) {
                    if !seen.insert((volume, index)) {
                        node.size = 0;
                        node.allocated_size = 0;
                        node.hardlink_duplicate = true;
                    }
                }
            }
        }
    }

    pub fn recompute_aggregates(&mut self) {
        for node in &mut self.nodes {
            if !node.active { continue; }
            match node.kind {
                NodeKind::Directory => {
                    node.size = 0;
                    node.allocated_size = 0;
                    node.file_count = 0;
                    node.dir_count = 0;
                }
                NodeKind::File => {
                    node.file_count = 1;
                    node.dir_count = 0;
                }
                _ => {
                    node.file_count = 0;
                    node.dir_count = 0;
                }
            }
        }
        let mut directories: Vec<NodeId> = self.nodes.iter()
            .filter(|node| node.active && node.kind == NodeKind::Directory)
            .map(|node| node.id)
            .collect();
        directories.sort_by_key(|id| Reverse((self.nodes[*id as usize].depth, *id)));
        for id in directories {
            let children = self.nodes[id as usize].children.clone();
            let mut size = 0u64;
            let mut allocated = 0u64;
            let mut files = 0u64;
            let mut dirs = 0u64;
            for child_id in children {
                let Some(child) = self.nodes.get(child_id as usize) else { continue; };
                if !child.active { continue; }
                size = size.saturating_add(child.size);
                allocated = allocated.saturating_add(child.allocated_size);
                files = files.saturating_add(child.file_count);
                dirs = dirs.saturating_add(child.dir_count);
                if child.kind == NodeKind::Directory { dirs = dirs.saturating_add(1); }
            }
            let node = &mut self.nodes[id as usize];
            node.size = size;
            node.allocated_size = allocated;
            node.file_count = files;
            node.dir_count = dirs;
        }
        self.scanned_bytes = self.nodes.first().filter(|node| node.active).map(|node| node.size).unwrap_or(0);
        self.allocated_bytes = self.nodes.first().filter(|node| node.active).map(|node| node.allocated_size).unwrap_or(0);
    }

    pub fn build_indexes(&mut self) {
        let mut ext: HashMap<String, (u64, u64, u64)> = HashMap::new();
        let mut largest_heap: BinaryHeap<(Reverse<u64>, NodeId)> = BinaryHeap::with_capacity(1001);
        let mut size_counts = [0u64; 8];
        let mut size_bytes = [0u64; 8];
        let mut age_counts = [0u64; 8];
        let mut age_bytes = [0u64; 8];
        let now_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        let mut hardlink_duplicates = 0u64;
        let mut extensionless_files = 0u64;
        let mut max_depth = 0u32;

        for node in &self.nodes {
            if !node.active { continue; }
            max_depth = max_depth.max(node.depth);
            if node.hardlink_duplicate {
                hardlink_duplicates = hardlink_duplicates.saturating_add(1);
            }
            if node.kind == NodeKind::File && !node.hardlink_duplicate {
                if node.extension.is_empty() {
                    extensionless_files = extensionless_files.saturating_add(1);
                }
                let entry = ext.entry(node.extension.clone()).or_insert((0, 0, 0));
                entry.0 = entry.0.saturating_add(1);
                entry.1 = entry.1.saturating_add(node.size);
                entry.2 = entry.2.saturating_add(node.allocated_size);
                if largest_heap.len() < 1000 {
                    largest_heap.push((Reverse(node.size), node.id));
                } else if largest_heap.peek().map(|entry| node.size > (entry.0).0).unwrap_or(false) {
                    largest_heap.pop();
                    largest_heap.push((Reverse(node.size), node.id));
                }

                let size_index = size_bucket_index(node.size);
                size_counts[size_index] = size_counts[size_index].saturating_add(1);
                size_bytes[size_index] = size_bytes[size_index].saturating_add(node.size);
                let age_index = age_bucket_index(node.modified_ms, now_ms);
                age_counts[age_index] = age_counts[age_index].saturating_add(1);
                age_bytes[age_index] = age_bytes[age_index].saturating_add(node.size);
            }
        }
        let mut largest: Vec<NodeId> = largest_heap.into_iter().map(|(_, id)| id).collect();
        largest.sort_by_key(|id| Reverse(self.nodes[*id as usize].size));
        self.largest = largest;
        let mut stats: Vec<ExtensionStat> = ext.into_iter().map(|(extension, (files, size, allocated_size))| {
            ExtensionStat { extension, files, size, allocated_size }
        }).collect();
        stats.sort_by_key(|s| Reverse(s.size));
        self.extension_stats = stats;

        const SIZE_LABELS: [&str; 8] = [
            "0 B", "1 B – 4 KiB", "4 KiB – 1 MiB", "1 – 10 MiB",
            "10 – 100 MiB", "100 MiB – 1 GiB", "1 – 10 GiB", "≥ 10 GiB",
        ];
        const AGE_LABELS: [&str; 8] = [
            "< 1 day", "1 – 7 days", "1 – 4 weeks", "1 – 3 months",
            "3 – 12 months", "1 – 3 years", "≥ 3 years", "Unknown",
        ];
        self.statistics = ScanStatistics {
            size_buckets: SIZE_LABELS.iter().enumerate().map(|(i, label)| DistributionBucket {
                label: (*label).to_string(), files: size_counts[i], size: size_bytes[i],
            }).collect(),
            age_buckets: AGE_LABELS.iter().enumerate().map(|(i, label)| DistributionBucket {
                label: (*label).to_string(), files: age_counts[i], size: age_bytes[i],
            }).collect(),
            max_depth,
            hardlink_duplicates,
            extensionless_files,
        };
    }
}

fn size_bucket_index(size: u64) -> usize {
    match size {
        0 => 0,
        1..=4095 => 1,
        4096..=1_048_575 => 2,
        1_048_576..=10_485_759 => 3,
        10_485_760..=104_857_599 => 4,
        104_857_600..=1_073_741_823 => 5,
        1_073_741_824..=10_737_418_239 => 6,
        _ => 7,
    }
}

fn age_bucket_index(modified_ms: Option<u64>, now_ms: u64) -> usize {
    let Some(modified_ms) = modified_ms else { return 7; };
    let age = now_ms.saturating_sub(modified_ms);
    const DAY: u64 = 86_400_000;
    if age < DAY { 0 }
    else if age < 7 * DAY { 1 }
    else if age < 30 * DAY { 2 }
    else if age < 90 * DAY { 3 }
    else if age < 365 * DAY { 4 }
    else if age < 3 * 365 * DAY { 5 }
    else { 6 }
}


pub fn modified_ms(metadata: &std::fs::Metadata) -> Option<u64> {
    let modified = metadata.modified().ok()?;
    modified.duration_since(UNIX_EPOCH).ok().map(|d| d.as_millis() as u64)
}

pub fn extension_for(path: &Path) -> String {
    path.extension()
        .and_then(|s| s.to_str())
        .map(|s| format!(".{}", s.to_lowercase()))
        .unwrap_or_default()
}

pub fn normalize_extension(value: &str) -> String {
    let lower = value.trim().to_lowercase();
    if lower.is_empty() || lower == "(none)" {
        String::new()
    } else if lower.starts_with('.') {
        lower
    } else {
        format!(".{lower}")
    }
}


#[cfg(test)]
mod tests {
    use super::*;

    fn node(
        id: NodeId,
        parent_id: Option<NodeId>,
        name: &str,
        kind: NodeKind,
        size: u64,
        allocated_size: u64,
        children: Vec<NodeId>,
        depth: u32,
    ) -> Node {
        Node {
            id,
            parent_id,
            active: true,
            hidden: false,
            name: name.to_string(),
            kind,
            size,
            allocated_size,
            raw_size: if kind == NodeKind::File { size } else { 0 },
            raw_allocated_size: if kind == NodeKind::File { allocated_size } else { 0 },
            identity_volume: None,
            identity_index: None,
            modified_ms: Some(1_000 + u64::from(id)),
            created_ms: None, owner_hint: String::new(), permissions_hint: String::new(), sparse: None, compressed: None,
            extension: if kind == NodeKind::File { ".txt".to_string() } else { String::new() },
            type_hint: String::new(),
            children,
            file_count: if kind == NodeKind::File { 1 } else { 0 },
            dir_count: 0,
            depth,
            hardlink_duplicate: false,
            link_count: 1,
        }
    }

    fn base_model(root: PathBuf, nodes: Vec<Node>) -> ScanModel {
        let mut model = ScanModel {
            root_path: root,
            nodes,
            errors: Vec::new(),
            error_count: 0,
            excluded_count: 0,
            extension_stats: Vec::new(),
            statistics: ScanStatistics::default(),
            largest: Vec::new(),
            scanned_bytes: 0,
            allocated_bytes: 0,
            scan_elapsed_ms: 0,
            filesystem_total_bytes: None,
            filesystem_available_bytes: None,
        };
        model.recompute_aggregates();
        model.build_indexes();
        model
    }

    #[test]
    fn selection_summary_deduplicates_ids_and_suppresses_selected_descendants() {
        let root = PathBuf::from("selection-root");
        let model = base_model(
            root,
            vec![
                node(0, None, "root", NodeKind::Directory, 0, 0, vec![1, 2], 0),
                node(1, Some(0), "dir", NodeKind::Directory, 0, 0, vec![3], 1),
                node(2, Some(0), "second.txt", NodeKind::File, 200, 240, vec![], 1),
                node(3, Some(1), "nested.txt", NodeKind::File, 100, 120, vec![], 2),
            ],
        );

        let normalized = model.normalized_selection(&[1, 3, 2, 2, 9999]);
        assert_eq!(normalized, vec![1, 2]);

        let summary = model.selection_summary(&[1, 3, 2, 2, 9999]);
        assert_eq!(summary.selected_items, 3);
        assert_eq!(summary.effective_items, 2);
        assert_eq!(summary.logical_size, 300);
        assert_eq!(summary.allocated_size, 360);
        assert_eq!(summary.files, 2);
        assert_eq!(summary.directories, 1);
    }

    #[test]
    fn incremental_reconcile_reuses_stable_ids_adds_new_nodes_and_tombstones_removed_nodes() {
        let root = PathBuf::from("refresh-root");
        let mut current = base_model(
            root.clone(),
            vec![
                node(0, None, "root", NodeKind::Directory, 0, 0, vec![1], 0),
                node(1, Some(0), "A", NodeKind::Directory, 0, 0, vec![2, 3], 1),
                node(2, Some(1), "old.txt", NodeKind::File, 10, 12, vec![], 2),
                node(3, Some(1), "gone.txt", NodeKind::File, 20, 24, vec![], 2),
            ],
        );
        let fresh = base_model(
            root.join("A"),
            vec![
                node(0, None, "A", NodeKind::Directory, 0, 0, vec![1, 2], 0),
                node(1, Some(0), "old.txt", NodeKind::File, 50, 60, vec![], 1),
                node(2, Some(0), "new.txt", NodeKind::File, 70, 84, vec![], 1),
            ],
        );

        let report = current.reconcile_subtree(1, &fresh, true).expect("subtree reconciliation should succeed");
        assert_eq!(report.target_id, 1);
        assert_eq!(report.new_ids, 1);
        assert_eq!(report.removed_ids, 1);
        assert_eq!(current.find_by_path(&root.join("A/old.txt")), Some(2), "existing path must keep its stable ID");
        assert_eq!(current.find_by_path(&root.join("A/new.txt")), Some(4), "new path should receive a fresh arena ID");
        assert_eq!(current.find_by_path(&root.join("A/gone.txt")), None, "removed path must disappear from active lookup");
        assert!(!current.nodes[3].active, "removed node must remain only as an inactive tombstone");
        assert_eq!(current.nodes[2].size, 50, "reused node metadata must be refreshed");
        assert_eq!(current.nodes[1].size, 120, "refreshed directory aggregate must be recomputed");
        assert_eq!(current.nodes[0].size, 120, "ancestor aggregate must be recomputed");
        assert_eq!(current.scanned_bytes, 120);
        assert_eq!(current.allocated_bytes, 144);
        assert_eq!(current.extension_stats.iter().find(|stat| stat.extension == ".txt").map(|stat| stat.files), Some(2));
    }

    #[test]
    fn incremental_reconcile_rejects_file_targets_without_mutating_model() {
        let root = PathBuf::from("refresh-file-root");
        let mut current = base_model(
            root.clone(),
            vec![
                node(0, None, "root", NodeKind::Directory, 0, 0, vec![1], 0),
                node(1, Some(0), "file.txt", NodeKind::File, 10, 12, vec![], 1),
            ],
        );
        let before = current.nodes.clone();
        let fresh = base_model(
            root.join("file.txt"),
            vec![node(0, None, "file.txt", NodeKind::Directory, 0, 0, vec![], 0)],
        );

        let error = current.reconcile_subtree(1, &fresh, true).expect_err("file refresh targets must be rejected");
        assert!(error.contains("must be a directory"));
        assert_eq!(current.nodes.len(), before.len());
        assert_eq!(current.nodes[1].name, before[1].name);
        assert_eq!(current.nodes[1].size, before[1].size);
        assert!(current.nodes[1].active);
    }
}
