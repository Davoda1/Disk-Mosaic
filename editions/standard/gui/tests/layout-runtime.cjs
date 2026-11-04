/* Rendered GUI regression suite. No disk scans or OS file actions are performed.
   Run: npm run test:layout (requires an installed Playwright and Chromium).
   DISKMOSAIC_PLAYWRIGHT / DISKMOSAIC_CHROMIUM may select local test tools.
   Browser fixtures and closure access exist ONLY in this test HTTP server. */
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.DISKMOSAIC_PLAYWRIGHT || 'playwright');
const root = path.resolve(__dirname, '../renderer');
const output = path.resolve(process.env.DISKMOSAIC_LAYOUT_OUTPUT || path.join(__dirname, '../../dependencies/layout-results'));
fs.mkdirSync(output, {recursive:true});
const instrument = `
  makeRequest = async command => window.__layoutReply(command);
  window.__layout = { state, setActiveView, openSettings, setSettingsSection,
    renderHistory, renderHistoryTimeline, populateHistoryPairSelectors,
    renderCleanupCandidates, renderIssuesCenter, renderAgeAnalysis, renderAllocationAnalysis, updateHistoryCompareState,
    applyTreeColumnLayout, layoutWorkspaceTabs, setTreemapMaximized, drawTreemap,
    treeList, extensionList, largestList, searchList, compareList, duplicateList,
    applySettings, openAbout, closeAbout, exploreHistoryTimeline, exportProfessionalReport, csvCell };
`;
const server = http.createServer((req,res)=>{
  const name=decodeURIComponent(req.url.split('?')[0]);
  const target=path.resolve(root,'.'+name);
  if(!target.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
  try {
    let data=fs.readFileSync(target);
    if(target.endsWith('/app.js')) data=Buffer.from(data.toString().replace(/\}\)\(\);\s*$/,instrument+'})();'));
    res.setHeader('Content-Type',target.endsWith('.js')?'text/javascript':target.endsWith('.css')?'text/css':target.endsWith('.png')?'image/png':'text/html');res.end(data);
  } catch {res.writeHead(404);res.end();}
});
const results=[];
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({headless:true,executablePath:process.env.DISKMOSAIC_CHROMIUM || undefined,
    args:process.env.DISKMOSAIC_CHROMIUM ? ['--use-gl=angle','--use-angle=swiftshader','--disable-dev-shm-usage'] : []});
  try {
    let page=await browser.newPage({viewport:{width:1600,height:900}});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(()=>{
      window.diskMosaic={onEngineEvent(){},setLanguage:async()=>{},sendEngine:async()=>{},getStartupPath:async()=>null};
      window.__layoutReply=command=>({items:[],roots:[],total:0,result:{points:[],buckets:[],categories:[],extensions:[],changes:[]}});
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
    await page.waitForFunction(()=>window.__layout);
    await page.evaluate(()=>{
      document.getElementById('startOverlay').classList.add('hidden');
      const t=window.__layout; t.state.settings.theme='dark';t.applySettings();
      t.state.historyRows=[];t.renderHistory();t.renderCleanupCandidates();t.renderIssuesCenter();
      document.getElementById('statusText').textContent='Layout fixture · no filesystem operations';
      document.getElementById('treemapCount').textContent='675 directory groups · 1,513 item tiles';
    });
    if(process.env.DISKMOSAIC_LAYOUT_INSPECT){
      await page.evaluate(()=>window.__layout.setActiveView('history'));
      await page.waitForTimeout(150);
      await page.screenshot({path:path.join(output,'inspect.png')});
      console.log(await page.evaluate(()=>[...document.querySelectorAll('#app > *,#historyView > *')].map(e=>({id:e.id||e.className,rect:JSON.stringify(e.getBoundingClientRect()),scroll:[e.scrollWidth,e.scrollHeight]}))));
      console.log('ERRORS',errors);return;
    }
    const check = async (label, fn, arg) => {
      const problems=await page.evaluate(fn,arg);
      results.push({label,passed:problems.length===0,problems});
      if(problems.length) console.log('FAIL',label,problems);
    };
    const settle=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
    const views=await page.locator('.tab').evaluateAll(tabs=>tabs.map(t=>t.dataset.view));
    const sections=await page.locator('#settingsNav button').evaluateAll(tabs=>tabs.map(t=>t.dataset.settingsSection));

    async function checkPopulatedHistory() {
      await page.evaluate(()=>{
        const t=window.__layout,root='/fixture/'+('long-directory-name/'.repeat(12));
        const points=Array.from({length:25},(_,i)=>({id:i+1,root_path:root,saved_ms:1700000000000+i*86400000,logical_bytes:10000000000+i*100000000,allocated_bytes:11000000000+i*110000000,files:607698+i*17,directories:47814+i}));
        const timeline={total_points:points.length,points,categories:[{category:'Documents',points:[points[0],points.at(-1)]}],extensions:[{extension:'.bin',points:[points[0],points.at(-1)]}]};
        window.__historyFixtureRestore={reply:window.__layoutReply,engineReady:t.state.engineReady,rootPath:t.state.rootPath};
        window.__layoutReply=command=>{
          if(command.cmd==='history_list')return {items:structuredClone(points),total:points.length};
          if(command.cmd==='history_roots')return {roots:[{root_path:root,scans:points.length}]};
          if(command.cmd==='history_timeline')return {result:structuredClone(timeline)};
          return window.__historyFixtureRestore.reply(command);
        };
        t.state.engineReady=true;t.state.rootPath=root;
      });
      try {
        for(const [width,height] of [[1024,700],[1280,720],[1600,900],[1920,1080]]) {
          await page.setViewportSize({width,height});
          await page.evaluate(()=>{window.__layout.setActiveView('history');document.getElementById('historyView').scrollTop=0;});
          await page.waitForFunction(()=>window.__layout.state.historyRows.length===25&&window.__layout.state.historyChartHitPoints.length===25);
          await settle();
          await check(`populated history ${width}x${height}/timeline`,()=>{
            const t=window.__layout,issues=[],view=document.getElementById('historyView'),chart=document.getElementById('historyChart');
            if(document.querySelectorAll('#historyList .history-row').length!==25)issues.push('fixture rows missing');
            if(t.state.historyChartHitPoints.length!==25)issues.push('timeline points missing');
            if(document.getElementById('historyBeforeSelect').options.length!==25||document.getElementById('historyAfterSelect').options.length!==25)issues.push('snapshot selectors empty');
            if(document.getElementById('historyComparePairButton').disabled)issues.push('populated comparison disabled');
            if(!document.getElementById('historyGrowthList').textContent.includes('Documents'))issues.push('contributors missing');
            if(view.scrollWidth>view.clientWidth+1)issues.push('history view horizontal overflow');
            if(chart.width!==Math.round(chart.clientWidth*devicePixelRatio)||chart.height!==Math.round(chart.clientHeight*devicePixelRatio))issues.push('timeline pixel geometry mismatch');
            return issues;
          });
          await page.screenshot({path:path.join(output,`populated-history-${width}x${height}-timeline.png`)});
          await page.locator('#historyList .history-row').first().scrollIntoViewIfNeeded();
          await settle();
          await check(`populated history ${width}x${height}/visible-rows`,()=>{
            const issues=[],view=document.getElementById('historyView'),list=document.getElementById('historyList');
            const rows=[...list.querySelectorAll('.history-row')],first=rows[0],v=view.getBoundingClientRect(),r=first?.getBoundingClientRect();
            if(rows.length!==25||!first?.textContent.includes('/fixture/long-directory-name/'))return ['populated history rows missing'];
            if(r.top<v.top||r.bottom>v.bottom||r.top<0||r.bottom>innerHeight)issues.push('fixture row is outside visible History area');
            const x=Math.max(v.left+2,Math.min(v.right-2,r.left+40)),y=r.top+r.height/2;
            if(document.elementFromPoint(x,y)?.closest('.history-row')!==first)issues.push('fixture row is covered or clipped');
            const table=list.parentElement,head=table.firstElementChild.getBoundingClientRect(),body=list.getBoundingClientRect();
            if(head.bottom>body.top+1||body.height<38)issues.push('history header overlaps rows');
            for(const cell of first.querySelectorAll('.numeric'))if(cell.scrollWidth>cell.clientWidth)issues.push('history metric clipped');
            if(view.scrollWidth>view.clientWidth+1)issues.push('history view horizontal overflow');
            return issues;
          });
          await page.screenshot({path:path.join(output,`populated-history-${width}x${height}-rows.png`)});
        }
      } finally {
        await page.evaluate(()=>{
          const t=window.__layout,saved=window.__historyFixtureRestore;
          window.__layoutReply=saved.reply;t.state.engineReady=saved.engineReady;t.state.rootPath=saved.rootPath;
          t.state.historyRows=[];t.state.historyTimeline=null;t.state.historyChartHitPoints=[];t.renderHistory();t.populateHistoryPairSelectors([]);
          delete window.__historyFixtureRestore;
        });
      }
    }
    if(process.env.DISKMOSAIC_LAYOUT_POPULATED_HISTORY_ONLY) {
      await checkPopulatedHistory();
      assert.deepEqual(errors,[],'renderer errors');
      fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({browser:await browser.version(),results},null,2));
      console.log(`${results.filter(x=>x.passed).length}/${results.length} populated history checks passed; ${output}`);
      assert.equal(results.filter(x=>!x.passed).length,0,'See results.json and screenshots');
      return;
    }

    // Smart Collection naming must use a working in-app dialog on Electron.
    await page.setViewportSize({width:1024,height:700});
    await page.evaluate(()=>{window.prompt=()=>{throw new Error('Native prompt must not be used');};window.__layout.setActiveView('search');});
    await page.click('#saveSmartCollectionButton');
    await check('Smart Collection name dialog containment and focus',()=>{
      const dialog=document.querySelector('#collectionNameModal .dialog'),rect=dialog.getBoundingClientRect();
      const input=document.getElementById('collectionNameInput'),issues=[];
      if(rect.left<0||rect.right>innerWidth||rect.top<0||rect.bottom>innerHeight||dialog.scrollWidth>dialog.clientWidth+1)issues.push('name dialog overflows');
      if(document.activeElement!==input)issues.push('name input did not receive focus');
      if(!document.getElementById('collectionNameSave').disabled)issues.push('empty name can be submitted');
      if(getComputedStyle(input).backgroundColor!==getComputedStyle(dialog).backgroundColor||getComputedStyle(input).color!==getComputedStyle(dialog).color)issues.push('input does not follow dialog theme');
      return issues;
    });
    await page.fill('#collectionNameInput','  Example collection  ');
    await page.screenshot({path:path.join(output,'smart-collection-name.png')});
    await page.click('#collectionNameSave');
    await page.waitForFunction(()=>document.getElementById('collectionNameModal').classList.contains('hidden'));
    await check('Smart Collection creation persists the entered name',()=>{
      const saved=JSON.parse(localStorage.getItem('diskmosaic.smartCollections')||'[]');
      return saved.length===1&&saved[0].name==='Example collection'&&document.getElementById('smartCollectionSelect').value===saved[0].id?[]:['collection was not saved'];
    });
    await page.click('#renameSmartCollectionButton');
    await page.fill('#collectionNameInput','Renamed collection');
    await page.press('#collectionNameInput','Enter');
    await page.waitForFunction(()=>document.getElementById('collectionNameModal').classList.contains('hidden'));
    await check('Smart Collection rename submits with Enter',()=>window.__layout.state.smartCollections[0]?.name==='Renamed collection'?[]:['rename did not apply']);
    await page.click('#renameSmartCollectionButton');
    await page.fill('#collectionNameInput','Discard this name');
    await page.press('#collectionNameInput','Escape');
    await check('Smart Collection Escape cancels and restores focus',()=>{
      const issues=[];
      if(window.__layout.state.smartCollections[0]?.name!=='Renamed collection')issues.push('cancel renamed the collection');
      if(!document.getElementById('collectionNameModal').classList.contains('hidden'))issues.push('dialog remained open');
      if(document.activeElement!==document.getElementById('renameSmartCollectionButton'))issues.push('focus was not restored');
      return issues;
    });
    await page.click('#saveSmartCollectionButton');
    await page.fill('#collectionNameInput','Discard new collection');
    await page.click('#collectionNameCancel');
    await check('Smart Collection Cancel leaves stored collections unchanged',()=>window.__layout.state.smartCollections.length===1?[]:['cancel created a collection']);

    // Real report functions talk to a deliberately exclusive model-analysis stub.
    // Concurrent requests would fail here just as they do in the Rust engine.
    await check('report generation sequences exclusive analyses and keeps all sections',async()=>{
      const t=window.__layout,previousReply=window.__layoutReply,previousSave=window.diskMosaic.saveTextFile;
      const previousRoot=t.state.rootNode,previousPath=t.state.rootPath,previousSummary=t.state.summary;
      const issues=[],calls=[];let busy=false,report;
      const file={id:1,kind:'file',name:'example.bin',path:'/fixture/example.bin',size:5,allocated_size:8,file_count:1,dir_count:0,modified_ms:null,extension:'.bin'};
      t.state.rootNode={id:0,kind:'directory',name:'fixture',path:'/fixture',size:5,allocated_size:8,file_count:1,dir_count:0};t.state.rootPath='/fixture';t.state.summary={bytes:5,allocated_bytes:8,files:1,directories:1};
      const modelCommands=new Set(['age_analysis','allocation_analysis','filesystem_context','issues_summary']);
      window.__layoutReply=async command=>{
        calls.push(command.cmd);
        if(modelCommands.has(command.cmd)){if(busy)throw new Error('Another analysis is active');busy=true;await new Promise(resolve=>setTimeout(resolve,5));busy=false;}
        if(command.cmd==='largest')return {items:[file]};
        if(command.cmd==='age_analysis')return {result:{total_files:1,total_logical:5,total_allocated:8,buckets:[{key:'unknown',label:'Unknown',logical_size:5,allocated_size:8,files:1,percentage:100}]}};
        if(command.cmd==='allocation_analysis')return {result:[{id:1,path:file.path,logical_size:5,allocated_size:8,difference:3,ratio:1.6}]};
        if(command.cmd==='filesystem_context')return {context:{filesystem:'fixture',volume:'fixture',total_bytes:100,available_bytes:20},used_bytes:80,scan_logical:5,scan_allocated:8,unaccounted_bytes:72};
        if(command.cmd==='issues_summary')return {result:[{category:'Example issue',count:1,paths:[],affects_completeness:true}]};
        return {items:[]};
      };
      window.diskMosaic.saveTextFile=async payload=>{report=JSON.parse(payload.content);return null;};
      try {
        await t.exportProfessionalReport('json');
        if(report?.age_distribution?.length!==1||report?.allocation_efficiency?.length!==1||report?.issues?.length!==1||report?.largest_files?.length!==1)issues.push('missing report section');
        if(!report?.filesystem_context?.includes('fixture'))issues.push('filesystem context missing');
        if(calls.filter(cmd=>modelCommands.has(cmd)).join(',')!=='age_analysis,allocation_analysis,filesystem_context,issues_summary')issues.push('unexpected analysis sequence');
      } catch(error){issues.push(error.message);}
      finally {window.__layoutReply=previousReply;window.diskMosaic.saveTextFile=previousSave;t.state.rootNode=previousRoot;t.state.rootPath=previousPath;t.state.summary=previousSummary;}
      return issues;
    });
    await check('CSV export escapes text formulas without changing numeric fields',()=>{
      const cell=window.__layout.csvCell,issues=[];
      for(const value of ['=1+1','+SUM(A1:A2)','-cmd','@command','  =1+1','\t=1+1'])if(!cell(value).startsWith('"\''))issues.push('formula remained active');
      if(cell(-12)!=='"-12"'||cell('ordinary "name"')!=='"ordinary ""name"""')issues.push('ordinary CSV value changed');
      return issues;
    });
    if(process.env.DISKMOSAIC_LAYOUT_BEHAVIOR_ONLY) {
      assert.deepEqual(errors,[],'renderer errors');
      fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({browser:await browser.version(),results},null,2));
      console.log(`${results.filter(x=>x.passed).length}/${results.length} behavioral checks passed; ${output}`);
      assert.equal(results.filter(x=>!x.passed).length,0,'See results.json and screenshots');
      return;
    }

    for(const theme of ['light','dark']) for(const [width,height] of [[1024,700],[1280,720],[1600,900],[1920,1080]]) {
      const config=`${width}x${height}-${theme}`;
      await page.setViewportSize({width,height});
      await page.evaluate(theme=>{const t=window.__layout;t.state.settings.theme=theme;t.applySettings();},theme);
      for(const view of views) {
        await page.evaluate(view=>window.__layout.setActiveView(view),view);await settle();
        await check(`${config}/${view}`,()=>{
          const issues=[], rect=e=>e.getBoundingClientRect();
          const active=document.querySelector('.view.active'), children=[...active.children].filter(e=>rect(e).height>0);
          if(document.documentElement.scrollHeight>innerHeight+1 || document.body.scrollWidth>innerWidth+1) issues.push('body overflow');
          const foot=rect(document.querySelector('.statusbar')), workspace=rect(document.getElementById('workspace'));
          if(Math.abs(foot.bottom-innerHeight)>1 || Math.abs(workspace.bottom-foot.top)>1) issues.push('unused bottom strip');
          if(active.scrollWidth>active.clientWidth+1) issues.push(`view horizontal overflow ${active.scrollWidth}/${active.clientWidth}`);
          for(let i=1;i<children.length;i++) if(rect(children[i]).top<rect(children[i-1]).bottom-1) issues.push(`overlapping sections ${i}`);
          const strip=rect(document.querySelector('.panel-tabs'));
          for(const tab of document.querySelectorAll('.tab:not(.tab-page-hidden)')) {const r=rect(tab);if(r.left<strip.left-1||r.right>strip.right+1) issues.push('partial tab '+tab.textContent);}
          const title=document.getElementById('typeStatsTitle'), header=title.closest('.type-heading');
          if(rect(title).top<rect(header).top || rect(title).bottom>rect(header).bottom)issues.push('extension title clipped');
          for(const table of active.querySelectorAll('.table-viewport')) {
            const h=rect(table.firstElementChild),list=rect(table.lastElementChild);
            if(h.bottom>list.top+1 || list.height<10) issues.push('table header overlaps rows or zero-height list');
          }
          const heading=rect(document.querySelector('.treemap-heading')),canvas=rect(document.getElementById('treemapCanvas'));
          if(heading.bottom>canvas.top+1||canvas.height<20) issues.push('treemap header/canvas overlap');
          return issues;
        });
      }
      await page.evaluate(()=>window.__layout.openSettings());
      for(const section of sections) {
        await page.evaluate(section=>window.__layout.setSettingsSection(section),section);await settle();
        await check(`${config}/settings-${section}`,()=>{
          const issues=[],rect=e=>e.getBoundingClientRect(),grid=document.querySelector('.settings-grid'),field=grid.querySelector('.settings-section-active');
          if(field.scrollWidth>field.clientWidth+1 || grid.scrollWidth>grid.clientWidth+1) issues.push('settings horizontal overflow');
          const modal=document.getElementById('settingsModal'),dialog=modal.firstElementChild;
          if(modal.scrollHeight>modal.clientHeight+1 || dialog.scrollHeight>dialog.clientHeight+1) issues.push('nested settings scrollbar');
          const footer=rect(document.querySelector('.settings-footer'));
          if(footer.bottom>innerHeight || footer.top<0)issues.push('settings footer clipped');
          if(field.getBoundingClientRect().width<grid.clientWidth*.85)issues.push('settings wastes width');
          for(const input of field.querySelectorAll('input[type=checkbox]')) {
            const r=rect(input),label=rect(input.closest('label'));if(r.width!==16||r.height!==16||r.left<label.left||r.right>label.right)issues.push('misaligned checkbox');
          }
          return issues;
        });
      }
      if(width===1280) await page.screenshot({path:path.join(output,`${config}-settings.png`)});
      await page.evaluate(()=>document.getElementById('settingsModal').classList.add('hidden'));
      await page.evaluate(()=>window.__layout.setActiveView('history'));await settle();
      await page.screenshot({path:path.join(output,`${config}-history.png`)});
    }
    // Populated investigations: long paths, large counters and many rows must
    // remain inside their cards/tables, not just pass with empty placeholders.
    await checkPopulatedHistory();
    await page.evaluate(()=>{
      const t=window.__layout,long='/fixture/'+('long-directory-name/'.repeat(12));
      t.state.cleanupRows=Array.from({length:12},(_,i)=>({id:i,path:long+i,logical_size:10000000000,allocated_size:11000000000,modified_ms:1700000000000,reasons:['Old large file','Explicit path rule']}));t.renderCleanupCandidates();
      t.state.issues=[{category:'Permission denied',count:42,affects_completeness:true,paths:[long+'a',long+'b']}];t.renderIssuesCenter();
      t.state.ageAnalysis={total_files:607698,total_logical:10000000000,total_allocated:11000000000,buckets:Array.from({length:8},(_,i)=>({key:'lt7d',label:'Age bucket '+i,logical_size:123456789,allocated_size:123456789,files:607698,percentage:12.5,largest_files:[{size:123456789,path:long+'file.bin'}],largest_directories:[{logical_size:123456789,path:long}]}))};t.renderAgeAnalysis();
      t.state.allocationRows=Array.from({length:12},(_,i)=>({id:i,path:long+i,logical_size:123456789,allocated_size:123456789,difference:100,ratio:1.01,sparse:false,compressed:false}));t.renderAllocationAnalysis();
    });
    for(const [width,height] of [[1024,700],[1280,720],[1600,900],[1920,1080]]) {
      await page.setViewportSize({width,height});
      for(const view of ['age','cleanup','allocation','issues']) {
        await page.evaluate(v=>window.__layout.setActiveView(v),view);await settle();
        await check(`populated ${width}x${height}/${view}`,()=>{
          const v=document.querySelector('.view.active'),issues=[];
          if(v.scrollWidth>v.clientWidth+1)issues.push('populated view overflow');
          for(const card of v.querySelectorAll('.age-card,.issue-card,.candidate-row'))if(card.scrollWidth>card.clientWidth+1)issues.push('populated card overflow');
          for(const table of v.querySelectorAll('.table-viewport')) {const h=table.firstElementChild.getBoundingClientRect(),list=table.lastElementChild.getBoundingClientRect();if(h.bottom>list.top+1)issues.push('populated header overlaps rows');}
          return issues;
        });
        if(width===1600)await page.screenshot({path:path.join(output,`populated-${view}.png`)});
      }
    }
    await page.evaluate(()=>{const t=window.__layout;t.state.historyRows=[];t.renderHistory();});

    // A live progress row, optional summary and maximize must not displace the footer.
    for(const progress of [false,true]) for(const summary of [false,true]) {
      await page.evaluate(({progress,summary})=>{document.getElementById('progressPanel').classList.toggle('hidden',!progress);document.getElementById('scanSummaryStrip').classList.toggle('hidden',!summary);window.__layout.setTreemapMaximized(true);},{progress,summary});await settle();
      await check(`grid visibility progress=${progress} summary=${summary}`,()=>{
        const p=document.querySelector('.treemap-panel').getBoundingClientRect(),w=document.getElementById('workspace').getBoundingClientRect(),c=document.getElementById('treemapCanvas').getBoundingClientRect();
        return Math.abs(p.bottom-(w.bottom-8))>1||Math.abs(c.bottom-p.bottom)>2?['maximized treemap leaves gap']:[];
      });
    }
    await page.evaluate(()=>{for(const id of ['progressPanel','scanSummaryStrip'])document.getElementById(id).classList.add('hidden');window.__layout.setTreemapMaximized(false);});
    // Exercise actual History state transitions, canvas pixel dimensions and hit-testing.
    await page.evaluate(()=>window.__layout.setActiveView('history'));await settle();
    for(const count of [0,1,2,0]) {
      await page.evaluate(count=>{
        const t=window.__layout;t.state.historyTimeline={points:Array.from({length:count},(_,i)=>({id:i+1,saved_ms:1700000000000+i*86400000,logical_bytes:1000000+i*100000,files:607698,directories:47814})),categories:[],extensions:[]};t.renderHistoryTimeline();
      },count);await settle();
      await check(`history ${count} points`,count=>{
        const issues=[],b=document.getElementById('historyComparePairButton'),c=document.getElementById('historyChart');
        if(b.disabled!==(count<2))issues.push('wrong comparison availability');
        if(c.width!==Math.round(c.clientWidth*devicePixelRatio)||c.height!==Math.round(c.clientHeight*devicePixelRatio))issues.push('chart pixels/hit coordinates differ');
        if(!count&&(document.getElementById('historyBeforeSelect').options.length||window.__layout.state.historyChartHitPoints.length))issues.push('stale history selections');
        return issues;
      },count);
    }
    // Large counts, reordered/hidden columns and horizontal scroll keep headers aligned.
    await page.evaluate(()=>{
      const t=window.__layout;t.setActiveView('directory');
      const node={id:1,kind:'directory',name:'Documents',path:'/fixture/Documents',size:1000000000,allocated_size:1000000000,file_count:607698,dir_count:47814,modified_ms:1700000000000};
      t.state.treeRows=[{type:'node',node,depth:0}];t.treeList.setRows(t.state.treeRows);
    });await settle();
    await check('large numbers and default timestamp',()=>{
      const issues=[];
      for(const key of ['files','directories','modified']) {const cell=document.querySelector(`.tree-row [data-tree-column=${key}]`);if(cell.scrollWidth>cell.clientWidth)issues.push('truncated '+key+' '+cell.scrollWidth+'/'+cell.clientWidth+' '+cell.textContent);}
      return issues;
    });
    await page.evaluate(()=>{const t=window.__layout;t.state.settings.treeColumnOrder=['name','files','modified','directories','share','allocated','logical','owner','permissions'];t.applyTreeColumnLayout();t.treeList.refresh();document.querySelector('.tree-table').scrollLeft=300;});await settle();
    await check('shared table scrolling and reorder',()=>{
      const issues=[];
      for(const cell of document.querySelectorAll('.tree-row [data-tree-column]')) if(cell.getBoundingClientRect().width) {
        const header=document.querySelector(`#treeHeader [data-tree-column=${cell.dataset.treeColumn}]`);
        if(Math.abs(cell.getBoundingClientRect().left-header.getBoundingClientRect().left)>1||Math.abs(cell.getBoundingClientRect().width-header.getBoundingClientRect().width)>1)issues.push('misaligned '+cell.dataset.treeColumn);
      }return issues;
    });
    // Divider behavior must survive every responsive breakpoint.
    await page.setViewportSize({width:1024,height:700});await settle();
    const before=await page.locator('.tree-panel').boundingBox(),split=await page.locator('#verticalSplitter').boundingBox();
    await page.mouse.move(split.x+2,split.y+20);await page.mouse.down();await page.mouse.move(split.x-130,split.y+20);await page.mouse.up();await settle();
    const after=await page.locator('.tree-panel').boundingBox();results.push({label:'responsive divider drag',passed:before.width-after.width>50,problems:before.width-after.width>50?[]:['divider ignored']});
    await page.evaluate(()=>window.__layout.openSettings());await settle();await page.evaluate(()=>window.__layout.openAbout());await settle();
    await check('About above Settings',()=>{const a=document.querySelector('#aboutModal .dialog').getBoundingClientRect();return document.elementFromPoint(a.x+a.width/2,a.y+20)?.closest('#aboutModal')?[]:['About covered'];});
    await page.evaluate(()=>{window.__layout.closeAbout();document.getElementById('settingsModal').classList.add('hidden');});
    // Directory-labels-off must remove directory captions in both renderers, while retaining file labels.
    await check('directory label switch 2D and 3D',()=>{
      const t=window.__layout,issues=[];t.state.treemapItems=[{id:2,parent_id:0,name:'Fixture directory',path:'/Fixture',kind:'directory',size:1000000,extension:'.bin'}];
      const ctx=document.getElementById('treemapCanvas').getContext('2d'),original=ctx.fillText;let calls=0;ctx.fillText=function(...args){calls++;return original.apply(this,args);};
      for(const mode of ['cushioned2d','extruded3d']) {t.state.settings.treemapVisualization=mode;t.state.settings.treemapLabels=false;calls=0;t.drawTreemap();if(calls)issues.push(mode+' labels persisted');t.state.settings.treemapLabels=true;calls=0;t.drawTreemap();if(!calls)issues.push(mode+' labels missing');}
      t.state.treemapItems[0].kind='file';t.state.settings.treemapLabels=false;calls=0;t.drawTreemap();if(!calls)issues.push('file labels incorrectly hidden');t.state.settings.treemapLabels=true;ctx.fillText=original;return issues;
    });
    // Language changes remeasure complete tab labels and preserve form containment.
    for(const language of ['en','de','hu','fr','it','es']) {
      await page.evaluate(language=>{const t=window.__layout;t.state.settings.language=language;t.applySettings();t.setActiveView('diagnostics');},language);await settle();
      await check(`translated navigation ${language}`,()=>{
        const strip=document.querySelector('.panel-tabs').getBoundingClientRect(),issues=[];
        for(const tab of document.querySelectorAll('.tab:not(.tab-page-hidden)')){const r=tab.getBoundingClientRect();if(r.left<strip.left-1||r.right>strip.right+1)issues.push('partial translated tab');}
        return issues;
      });
      await page.evaluate(()=>window.__layout.openSettings());
      for(const section of sections){await page.evaluate(s=>window.__layout.setSettingsSection(s),section);await settle();await check(`translated settings ${language}/${section}`,()=>{
        const g=document.querySelector('.settings-grid'),f=g.querySelector('.settings-section-active');return g.scrollWidth>g.clientWidth+1||f.scrollWidth>f.clientWidth+1?['translated settings overflow']:[];
      });}
      await page.evaluate(()=>document.getElementById('settingsModal').classList.add('hidden'));
    }
    const originalPage=page;
    for(const [factor,width,height] of [[1.25,1024,700],[1.5,1280,720],[2,960,540]]) {
      page=await browser.newPage({viewport:{width,height},deviceScaleFactor:factor});page.on('pageerror',e=>errors.push(e.message));
      await page.addInitScript(()=>{window.diskMosaic={onEngineEvent(){},setLanguage:async()=>{},sendEngine:async()=>{},getStartupPath:async()=>null};window.__layoutReply=()=>({items:[],roots:[],total:0,result:{points:[],buckets:[],categories:[],extensions:[],changes:[]}});});
      await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);await page.waitForFunction(()=>window.__layout);
      await page.evaluate(()=>{document.getElementById('startOverlay').classList.add('hidden');window.__layout.setActiveView('history');});await settle();
      await check(`DPI ${factor} history`,()=>{
        const t=window.__layout;t.state.historyTimeline={points:[{id:1,saved_ms:1700000000000,logical_bytes:1000},{id:2,saved_ms:1700000010000,logical_bytes:2000}],categories:[],extensions:[]};t.renderHistoryTimeline();const c=document.getElementById('historyChart');
        return c.width!==Math.round(c.clientWidth*devicePixelRatio)||c.height!==Math.round(c.clientHeight*devicePixelRatio)?['DPI chart geometry mismatch']:[];
      });
      for(const view of views){await page.evaluate(v=>window.__layout.setActiveView(v),view);await settle();await check(`DPI ${factor} workspace ${view}`,()=>{
        const v=document.querySelector('.view.active'),f=document.querySelector('.statusbar').getBoundingClientRect();return v.scrollWidth>v.clientWidth+1||Math.abs(f.bottom-innerHeight)>1?['DPI workspace overflow']:[];
      });}
      await page.evaluate(()=>window.__layout.openSettings());
      for(const section of sections){await page.evaluate(s=>window.__layout.setSettingsSection(s),section);await settle();await check(`DPI ${factor} settings ${section}`,()=>{
        const g=document.querySelector('.settings-grid'),f=g.querySelector('.settings-section-active'),m=document.getElementById('settingsModal');return g.scrollWidth>g.clientWidth+1||f.scrollWidth>f.clientWidth+1||m.scrollHeight>m.clientHeight+1?['DPI settings overflow']:[];
      });}
      await page.screenshot({path:path.join(output,`dpi-${factor}-settings.png`)});await page.close();
    }
    page=originalPage;

    assert.deepEqual(errors,[],'renderer errors');
    fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({browser:await browser.version(),results},null,2));
    console.log(`${results.filter(x=>x.passed).length}/${results.length} rendered checks passed; ${output}`);
    assert.equal(results.filter(x=>!x.passed).length,0,'See results.json and screenshots');

  } finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
