/* Pure layout decisions shared by the renderer and regression tests. */
(function (root) {
  'use strict';
  function tabPage(widths, available, start = 0, anchor = null) {
    start = Math.max(0, Math.min(widths.length - 1, start));
    const endFrom = first => {
      let used = 0, end = first;
      while (end < widths.length && used + widths[end] <= available) used += widths[end++];
      return Math.max(first + 1, end);
    };
    let end = endFrom(start);
    if (anchor != null && (anchor < start || anchor >= end)) {
      start = anchor;
      // Reveal the active tab along with as many preceding whole tabs as fit.
      let used = widths[anchor];
      while (start > 0 && used + widths[start - 1] <= available) used += widths[--start];
      end = endFrom(start);
    }
    return { start, end: Math.min(widths.length, end) };
  }
  function validHistoryPair(before, after, points) {
    return !!before && !!after && String(before) !== String(after)
      && points.some(p => String(p.id) === String(before))
      && points.some(p => String(p.id) === String(after));
  }
  function columnMinimum(key) {
    return ({ name: 160, files: 90, directories: 90, modified: 210 })[key] || 48;
  }
  const api = { tabPage, validHistoryPair, columnMinimum };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DiskMosaicLayout = api;
})(typeof window === 'object' ? window : globalThis);
