const test = require('node:test');
const assert = require('node:assert/strict');
const { tabPage, validHistoryPair, columnMinimum } = require('../renderer/layout.js');
test('whole-tab pages contain only tabs that fit and retain the active tab', () => {
  const widths=[80,110,95,65,85,120,85,60,105,105,95,80,110];
  for(const available of [280,400,600,900,1400]) for(let anchor=0;anchor<widths.length;anchor++) {
    const p=tabPage(widths,available,0,anchor);
    assert.ok(p.start<=anchor && anchor<p.end);
    assert.ok(widths.slice(p.start,p.end).reduce((a,b)=>a+b,0)<=available);
  }
});
test('paging can reach every tab without partial labels',()=>{
  const widths=Array.from({length:13},(_,i)=>70+i*5);let start=0;const seen=[];
  while(start<widths.length){const p=tabPage(widths,300,start);for(let i=p.start;i<p.end;i++)seen.push(i);assert.ok(p.end>start);start=p.end;}
  assert.deepEqual(seen,widths.map((_,i)=>i));
});
test('comparison requires two different IDs in the current timeline',()=>{
  for(const [before,after,points] of [['','',[]],['1','1',[{id:1}]],['1','2',[]],['1','3',[{id:1},{id:2}]]])assert.equal(validHistoryPair(before,after,points),false);
  assert.equal(validHistoryPair('1','2',[{id:1},{id:2}]),true);
});
test('numeric and timestamp minima protect saved legacy column widths',()=>{
  assert.equal(columnMinimum('files'),90);assert.equal(columnMinimum('directories'),90);
  assert.equal(columnMinimum('modified'),210);assert.equal(columnMinimum('name'),160);
});
