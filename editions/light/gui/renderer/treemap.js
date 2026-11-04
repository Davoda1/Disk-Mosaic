(() => {
  'use strict';

  function worst(row, side) {
    if (!row.length || side <= 0) return Infinity;
    let sum = 0;
    let min = Infinity;
    let max = 0;
    for (const item of row) {
      sum += item.area;
      min = Math.min(min, item.area);
      max = Math.max(max, item.area);
    }
    if (min <= 0 || sum <= 0) return Infinity;
    const s2 = side * side;
    const sum2 = sum * sum;
    return Math.max((s2 * max) / sum2, sum2 / (s2 * min));
  }

  // Lay a squarified row along the short side of the remaining rectangle.
  function layoutRow(row, rect, out) {
    const sum = row.reduce((total, item) => total + item.area, 0);
    if (rect.w >= rect.h) {
      const w = rect.h > 0 ? sum / rect.h : 0;
      let y = rect.y;
      for (const item of row) {
        const h = w > 0 ? item.area / w : 0;
        out.push({ ...item, x: rect.x, y, w, h });
        y += h;
      }
      rect.x += w;
      rect.w = Math.max(0, rect.w - w);
    } else {
      const h = rect.w > 0 ? sum / rect.w : 0;
      let x = rect.x;
      for (const item of row) {
        const w = h > 0 ? item.area / h : 0;
        out.push({ ...item, x, y: rect.y, w, h });
        x += w;
      }
      rect.y += h;
      rect.h = Math.max(0, rect.h - h);
    }
  }

  function layoutRect(items, bounds) {
    const source = items.filter(item => Number(item.size) > 0);
    const total = source.reduce((sum, item) => sum + Number(item.size), 0);
    if (!source.length || total <= 0 || bounds.w <= 0 || bounds.h <= 0) return [];

    const scale = (bounds.w * bounds.h) / total;
    const pending = source
      .map(item => ({ item, area: Number(item.size) * scale }))
      .sort((a, b) => b.area - a.area);

    const rect = { ...bounds };
    const out = [];
    let row = [];
    while (pending.length) {
      const next = pending[0];
      const side = Math.max(1e-9, Math.min(rect.w, rect.h));
      if (!row.length || worst([...row, next], side) <= worst(row, side)) {
        row.push(pending.shift());
      } else {
        layoutRow(row, rect, out);
        row = [];
      }
    }
    if (row.length) layoutRow(row, rect, out);
    return out.map(entry => ({ ...entry.item, x: entry.x, y: entry.y, w: entry.w, h: entry.h }));
  }

  function layout(items, width, height) {
    return layoutRect(items, { x: 0, y: 0, w: width, h: height });
  }

  // Hierarchical treemap. Each directory first receives an outer rectangle based
  // on its true total size; that same rectangle is recursively partitioned among
  // its direct children. Because no padding is removed from the geometry, a leaf's
  // allocated area remains mathematically proportional to its size at the root.
  // Directory grouping is drawn later as an overlay border, so visual hierarchy
  // does not distort the disk-usage ratios.
  function layoutHierarchy(items, rootId, width, height, maxDepth = 64) {
    if (width <= 0 || height <= 0) return { leaves: [], groups: [] };
    const children = new Map();
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      if (!(Number(item.size) > 0)) continue;
      const parent = item.parent_id == null ? rootId : item.parent_id;
      if (!children.has(parent)) children.set(parent, []);
      children.get(parent).push({ ...item, _sourceIndex: index });
    }

    const leaves = [];
    const groups = [];
    const visiting = new Set();

    function walk(parentId, bounds, depth) {
      if (depth > 64 || visiting.has(parentId)) return;
      const siblings = children.get(parentId) || [];
      if (!siblings.length) return;
      visiting.add(parentId);
      const laidOut = layoutRect(siblings, bounds);
      for (const rect of laidOut) {
        const hasChildren = depth < Math.max(0, Number(maxDepth) || 0) && rect.id != null && rect.kind === 'directory' && children.has(rect.id);
        if (hasChildren) {
          groups.push({ ...rect, depth, expanded: true });
          walk(rect.id, { x: rect.x, y: rect.y, w: rect.w, h: rect.h }, depth + 1);
        } else {
          leaves.push({ ...rect, depth, expanded: false });
        }
      }
      visiting.delete(parentId);
    }

    walk(rootId, { x: 0, y: 0, w: width, h: height }, 0);
    return { leaves, groups };
  }

  // Four-sided raised-block presentation geometry. The source rectangle stays
  // authoritative for area, size semantics and hit testing. The visible front
  // face is inset on every edge, leaving four surrounding trapezoid faces
  // (top/right/bottom/left) entirely inside the original footprint. This gives
  // the raised-tile appearance without covering or stealing area from neighbors.
  function extrusion(rect, strength = 45) {
    const w = Math.max(0, Number(rect.w) || 0);
    const h = Math.max(0, Number(rect.h) || 0);
    const x = Number(rect.x) || 0;
    const y = Number(rect.y) || 0;
    const requested = Math.max(0, Math.min(100, Number(strength) || 0));
    const depth = requested <= 0 ? 0 : Math.min(18, Math.min(w, h) * 0.24, 1.5 + requested * 0.135);
    if (w < 4 || h < 4 || depth < 0.7) {
      return {
        degraded: true, depth: 0, authoritative: { x, y, w, h },
        front: [[x,y],[x+w,y],[x+w,y+h],[x,y+h]],
        top: [], right: [], bottom: [], left: [], side: [],
      };
    }
    const maxInset = Math.max(0.75, (Math.min(w, h) - 1) / 2);
    const d = Math.min(depth, maxInset);
    const front = [[x+d,y+d],[x+w-d,y+d],[x+w-d,y+h-d],[x+d,y+h-d]];
    const top = [[x,y],[x+w,y],[x+w-d,y+d],[x+d,y+d]];
    const right = [[x+w,y],[x+w,y+h],[x+w-d,y+h-d],[x+w-d,y+d]];
    const bottom = [[x+d,y+h-d],[x+w-d,y+h-d],[x+w,y+h],[x,y+h]];
    const left = [[x,y],[x+d,y+d],[x+d,y+h-d],[x,y+h]];
    return {
      degraded: false, depth: d, authoritative: { x, y, w, h },
      front, top, right, bottom, left,
      // Compatibility alias for code/tests that referred to the old right face.
      side: right,
    };
  }

  function hitTest(rects, x, y) {
    for (let i = rects.length - 1; i >= 0; i -= 1) {
      const r = rects[i];
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return r;
    }
    return null;
  }

  window.DiskMosaicTreemap = Object.freeze({ layout, layoutHierarchy, extrusion, hitTest });
})();
