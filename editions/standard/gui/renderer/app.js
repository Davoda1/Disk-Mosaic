(() => {
  'use strict';

  const api = window.diskMosaic;
  if (!api) throw new Error('DiskMosaic preload API is unavailable');

  const $ = id => document.getElementById(id);
  const i18n = window.DiskMosaicI18n;
  const fileTypes = window.DiskMosaicFileTypes;
  const t = (source, vars) => i18n?.t(source, vars) ?? source;
  const state = {
    engineReady: false,
    scanning: false,
    scanPaused: false,
    analyzing: false,
    rootNode: null,
    rootPath: null,
    summary: null,
    selectedNode: null,
    treeRows: [],
    treeSort: { field: 'size', descending: true },
    extensionStats: [],
    statistics: null,
    typeMode: 'extension',
    extensionSort: { field: 'size', descending: true },
    largestRows: [],
    largestSort: { field: 'size', descending: true },
    activeExtensions: [],
    activeCategories: [],
    treemapParent: 0,
    treemapParentNode: null,
    treemapItems: [],
    treemapRects: [],
    treemapGroupRects: [],
    treemapHistory: [],
    treemapHover: null,
    treemapMaximized: false,
    treemapWheelAt: 0,
    contextNode: null,
    pending: new Map(),
    settings: null,
    errorCount: 0,
    sizeBasis: 'logical',
    duplicateResult: null,
    duplicateRows: [],
    comparisonResult: null,
    comparisonRows: [],
    snapshotPath: null,
    selectedIds: new Set(),
    selectionSummary: null,
    selectionTruncated: false,
    selectionAnchorIndex: null,
    richMetadata: null,
    metadataToken: 0,
    selectionInspectorToken: 0,
    watcherState: 'not_watching',
    watcherRefreshPending: false,
    historyRows: [],
    navBack: [],
    navForward: [],
    treemapMode: 'current',
    historyTimeline: null,
    ageAnalysis: null,
    allocationRows: [],
    cleanupRows: [],
    issues: [],
    diagnostics: null,
    reportTopDirectories: [],
    smartCollections: [],
    activeSettingsSection: 'general',
  };

  const defaultSettings = Object.freeze({
    language: 'en',
    theme: 'system',
    units: 'iec',
    sizeBasis: 'logical',
    duplicateMinSize: '1 MiB',
    confirmTrash: true,
    hiddenDisplayMode: 'show_all',
    workers: 0,
    followSymlinks: false,
    crossFilesystems: true,
    hardlinks: true,
    watchFilesystem: false,
    watchDebounce: 500,
    treeColumns: { logical: true, allocated: true, share: true, files: true, directories: true, modified: true, owner: false, permissions: false },
    treeColumnOrder: ['name','logical','allocated','share','files','directories','modified','owner','permissions'],
    treeColumnWidths: { name: 260, logical: 88, allocated: 88, share: 104, files: 90, directories: 90, modified: 210, owner: 100, permissions: 110 },
    excludePatterns: '',
    categoryRules: '',
    treemapColorMode: 'category',
    treemapVisualization: 'cushioned2d',
    treemapExtrusionDepth: 45,
    treemapMinPx: 4,
    treemapMaxItems: 2200,
    treemapCushion: true,
    treemapCushionStrength: 78,
    treemapDepth: 'auto',
    treemapLabels: true,
    treemapBorders: true,
    treemapBorderDepth: 3,
    animation: true,
    reducedMotion: false,
    highContrastFocus: false,
    alternatingRows: false,
    fileTypeOverrides: '',
    historyAutoRetention: false,
    historyRetentionMode: 'all',
    historyKeepLast: 100,
    historyKeepMonths: 24,
    settingsSection: 'general',
    treeShareBandColorsEnabled: false,
    treeShareBandColors: ['#2ea043', '#3b82f6', '#d6a700', '#d73a49'],
    treeShareBandMaxima: [5, 75, 80, 100],
    treeWidth: 68,
    topHeight: 48,
    visualizerRevision: 5,
  });

  const DEFAULT_FILE_CATEGORIES = Object.freeze([
    { name: 'Video', color: '#4b63d8', extensions: ['.mkv','.mp4','.avi','.mov','.webm','.wmv','.m4v','.mpeg','.mpg','.mpe','.ts','.m2ts','.mts','.flv','.f4v','.ogv','.3gp','.3g2','.vob','.asf','.rm','.rmvb','.divx'] },
    { name: 'Audio', color: '#00a6a6', extensions: ['.mp3','.flac','.wav','.wave','.m4a','.aac','.ogg','.oga','.opus','.wma','.alac','.aiff','.aif','.ape','.mid','.midi','.amr','.ac3','.dts','.mka'] },
    { name: 'Images', color: '#49b742', extensions: ['.png','.jpg','.jpeg','.jpe','.gif','.webp','.bmp','.dib','.tif','.tiff','.svg','.svgz','.ico','.icns','.heic','.heif','.avif','.jxl','.raw','.cr2','.cr3','.nef','.arw','.dng','.orf','.rw2','.psd','.xcf','.kra','.ai','.eps'] },
    { name: 'Archives', color: '#d39100', extensions: ['.zip','.7z','.rar','.tar','.gz','.bz2','.xz','.zst','.tgz','.tbz','.tbz2','.txz','.cab','.arj','.lha','.lzh','.ace','.cpio','.lz','.lzma'] },
    { name: 'Disk images', color: '#c49a00', extensions: ['.iso','.vhd','.vhdx','.vmdk','.qcow','.qcow2','.img','.dmg','.toast','.nrg','.wim','.esd','.ova','.ovf','.vdi','.vfd','.hdd','.pvm'] },
    { name: 'Documents', color: '#2786d8', extensions: ['.pdf','.doc','.docx','.docm','.dot','.dotx','.odt','.ott','.rtf','.txt','.text','.md','.markdown','.rst','.tex','.latex','.epub','.mobi','.azw','.azw3','.fb2','.pages','.numbers','.key','.xlsx','.xls','.xlsm','.xlsb','.ods','.ots','.ppt','.pptx','.pptm','.odp','.csv','.tsv','.html','.htm','.xhtml','.mhtml','.chm'] },
    { name: 'Executables', color: '#cc2c76', extensions: ['.exe','.msi','.msix','.msixbundle','.appx','.appxbundle','.com','.scr','.cpl','.bat','.cmd','.ps1','.psm1','.psd1','.vbs','.vbe','.wsf','.wsh','.sh','.bash','.zsh','.fish','.ksh','.csh','.tcsh','.command','.appimage','.desktop','.run'] },
    { name: 'Libraries', color: '#d45656', extensions: ['.dll','.so','.dylib','.a','.lib','.sys','.ko','.o','.obj','.pdb','.wasm','.class','.jar','.framework'] },
    { name: 'Development', color: '#8c5ad6', extensions: [
      '.rs','.c','.h','.cc','.cpp','.cxx','.hh','.hpp','.hxx','.m','.mm','.cs','.java','.go','.swift','.kt','.kts','.scala','.sc',
      '.py','.pyw','.pyi','.js','.mjs','.cjs','.jsx','.ts','.mts','.cts','.tsx','.php','.phtml','.rb','.pl','.pm','.lua','.r','.jl','.dart',
      '.ex','.exs','.erl','.hrl','.hs','.lhs','.ml','.mli','.fs','.fsx','.fsi','.vb','.pas','.pp','.f','.for','.f77','.f90','.f95','.f03','.f08',
      '.cob','.cbl','.lisp','.lsp','.scm','.ss','.clj','.cljs','.cljc','.edn','.groovy','.gradle','.sol','.zig','.nim','.v','.d','.cr','.raku',
      '.adb','.ads','.asm','.s','.sql','.graphql','.gql','.vue','.svelte','.astro','.css','.scss','.sass','.less','.glsl','.vert','.frag','.geom',
      '.comp','.hlsl','.wgsl','.wat','.wast','.proto','.thrift','.cmake','.bazel','.bzl','.tf','.tfvars','.nix','.jinja','.j2','.hbs','.mustache',
      '.json','.json5','.jsonc','.xml','.xsd','.xsl','.xslt','.yaml','.yml','.toml','.ini','.cfg','.conf','.properties','.env'
    ] },
    { name: 'Data / game assets', color: '#e34e49', extensions: ['.dat','.bin','.pak','.pck','.wad','.bsa','.ba2','.vpk','.uasset','.umap','.dds','.bundle','.asset','.assets','.sav','.save','.gam','.rom','.nes','.sfc','.smc','.gba','.nds','.3ds','.cia','.xci','.nsp','.cache','.log','.torrent'] },
    { name: 'Subtitles', color: '#9a36c8', extensions: ['.srt','.ass','.ssa','.sub','.vtt','.smi','.sami','.sup'] },
    { name: 'Other', color: '#687786', extensions: ['.ttf','.otf','.woff','.woff2','.eot','.fon','.db','.sqlite','.sqlite3','.mdb','.accdb','.dbf','.parquet','.avro','.orc','.blend','.fbx','.obj','.stl','.3mf','.gltf','.glb','.dae','.step','.stp','.iges','.igs','.dwg','.dxf','.cer','.crt','.pem','.der','.pfx','.p12','.keychain'] },
  ]);



  // Custom, locally-rendered file-type badges. They intentionally do not copy
  // third-party/trademark artwork, which keeps the source self-contained and
  // avoids adding icon-pack licensing obligations.
  const CODE_ICON_GROUPS = Object.freeze([
    ['rust','Rs','Rust',['.rs']], ['c','C','C',['.c']], ['cpp','C+','C++',['.cc','.cpp','.cxx','.hh','.hpp','.hxx']],
    ['cheader','H','C/C++ header',['.h']], ['objc','O-C','Objective-C',['.m','.mm']], ['csharp','C#','C#',['.cs']],
    ['java','Jv','Java',['.java']], ['go','Go','Go',['.go']], ['swift','Sw','Swift',['.swift']], ['kotlin','Kt','Kotlin',['.kt','.kts']],
    ['scala','Sc','Scala',['.scala','.sc']], ['python','Py','Python',['.py','.pyw','.pyi']], ['javascript','JS','JavaScript',['.js','.mjs','.cjs']],
    ['jsx','JX','JSX',['.jsx']], ['typescript','TS','TypeScript',['.ts','.mts','.cts']], ['tsx','TX','TSX',['.tsx']],
    ['php','PHP','PHP',['.php','.phtml']], ['ruby','Rb','Ruby',['.rb']], ['perl','Pl','Perl',['.pl','.pm']], ['lua','Lua','Lua',['.lua']],
    ['r','R','R',['.r']], ['julia','Jl','Julia',['.jl']], ['dart','Dt','Dart',['.dart']], ['elixir','Ex','Elixir',['.ex','.exs']],
    ['erlang','Er','Erlang',['.erl','.hrl']], ['haskell','Hs','Haskell',['.hs','.lhs']], ['ocaml','ML','OCaml',['.ml','.mli']],
    ['fsharp','F#','F#',['.fs','.fsx','.fsi']], ['vb','VB','Visual Basic',['.vb']], ['pascal','Pas','Pascal',['.pas','.pp']],
    ['fortran','F','Fortran',['.f','.for','.f77','.f90','.f95','.f03','.f08']], ['cobol','Cob','COBOL',['.cob','.cbl']],
    ['lisp','Li','Lisp',['.lisp','.lsp']], ['scheme','Sch','Scheme',['.scm','.ss']], ['clojure','Clj','Clojure',['.clj','.cljs','.cljc','.edn']],
    ['groovy','Gr','Groovy',['.groovy','.gradle']], ['solidity','Sol','Solidity',['.sol']], ['zig','Zig','Zig',['.zig']], ['nim','Nim','Nim',['.nim']],
    ['vlang','V','V',['.v']], ['dlang','D','D',['.d']], ['crystal','Cr','Crystal',['.cr']], ['raku','Rk','Raku',['.raku']],
    ['ada','Ada','Ada',['.adb','.ads']], ['assembly','Asm','Assembly',['.asm','.s']], ['sql','SQL','SQL',['.sql']],
    ['graphql','GQL','GraphQL',['.graphql','.gql']], ['vue','Vue','Vue',['.vue']], ['svelte','Sv','Svelte',['.svelte']], ['astro','Ast','Astro',['.astro']],
    ['html','<>','HTML',['.html','.htm','.xhtml']], ['css','CSS','CSS',['.css']], ['sass','Sass','Sass/SCSS',['.scss','.sass']], ['less','Less','Less',['.less']],
    ['json','{}','JSON',['.json','.json5','.jsonc']], ['xml','XML','XML',['.xml','.xsd','.xsl','.xslt']], ['yaml','YML','YAML',['.yaml','.yml']],
    ['toml','TOM','TOML',['.toml']], ['ini','INI','INI/config',['.ini','.cfg','.conf','.properties','.env']],
    ['shader','GL','Shader source',['.glsl','.vert','.frag','.geom','.comp','.hlsl','.wgsl']], ['wasm','W','WebAssembly',['.wat','.wast']],
    ['protobuf','Pb','Protocol Buffers',['.proto']], ['thrift','Th','Thrift',['.thrift']], ['cmake','CM','CMake',['.cmake']],
    ['bazel','Bz','Bazel',['.bazel','.bzl']], ['terraform','TF','Terraform',['.tf','.tfvars']], ['nix','Nx','Nix',['.nix']],
    ['template','Tpl','Template',['.jinja','.j2','.hbs','.mustache']], ['shell','$','Shell script',['.sh','.bash','.zsh','.fish','.ksh','.csh','.tcsh','.command']],
    ['powershell','PS','PowerShell',['.ps1','.psm1','.psd1']], ['batch','BAT','Windows batch',['.bat','.cmd']],
  ]);

  const CODE_ICON_BY_EXTENSION = new Map();
  for (const [key, glyph, label, extensions] of CODE_ICON_GROUPS) {
    for (const extension of extensions) CODE_ICON_BY_EXTENSION.set(extension, { key, glyph, label, family: 'code' });
  }

  const TYPE_HINT_ICONS = Object.freeze({
    'elf': { key: 'elf', glyph: 'ELF', label: 'ELF executable', family: 'executable' },
    'pe-executable': { key: 'pe', glyph: 'EXE', label: 'Windows executable', family: 'executable' },
    'mach-o': { key: 'macho', glyph: 'MO', label: 'Mach-O executable', family: 'executable' },
    'executable': { key: 'executable', glyph: 'EXE', label: 'Executable file', family: 'executable' },
    'script-shell': { key: 'shell', glyph: '$', label: 'Shell script', family: 'code' },
    'code-python': { key: 'python', glyph: 'Py', label: 'Python script', family: 'code' },
    'code-javascript': { key: 'javascript', glyph: 'JS', label: 'JavaScript', family: 'code' },
    'code-ruby': { key: 'ruby', glyph: 'Rb', label: 'Ruby script', family: 'code' },
    'code-perl': { key: 'perl', glyph: 'Pl', label: 'Perl script', family: 'code' },
    'code-php': { key: 'php', glyph: 'PHP', label: 'PHP script', family: 'code' },
    'code-lua': { key: 'lua', glyph: 'Lua', label: 'Lua script', family: 'code' },
    'code-powershell': { key: 'powershell', glyph: 'PS', label: 'PowerShell script', family: 'code' },
    'code-awk': { key: 'awk', glyph: 'Awk', label: 'AWK script', family: 'code' },
    'code-typescript': { key: 'typescript', glyph: 'TS', label: 'TypeScript', family: 'code' },
    'makefile': { key: 'make', glyph: 'Mk', label: 'Makefile', family: 'code' },
    'dockerfile': { key: 'docker', glyph: 'Dk', label: 'Dockerfile / Containerfile', family: 'code' },
    'cmake': { key: 'cmake', glyph: 'CM', label: 'CMake file', family: 'code' },
    'config': { key: 'config', glyph: 'CFG', label: 'Configuration file', family: 'config' },
    'text': { key: 'text', glyph: 'TXT', label: 'Text file', family: 'text' },
    'binary': { key: 'binary', glyph: 'BIN', label: 'Binary data', family: 'binary' },
    'pdf': { key: 'pdf', glyph: 'PDF', label: 'PDF document', family: 'pdf' },
    'image-png': { key: 'png', glyph: 'PNG', label: 'PNG image', family: 'image' },
    'image-jpeg': { key: 'jpeg', glyph: 'JPG', label: 'JPEG image', family: 'image' },
    'image-gif': { key: 'gif', glyph: 'GIF', label: 'GIF image', family: 'image' },
    'archive-zip': { key: 'zip', glyph: 'ZIP', label: 'ZIP archive', family: 'archive' },
    'archive-7z': { key: '7z', glyph: '7Z', label: '7-Zip archive', family: 'archive' },
    'archive-rar': { key: 'rar', glyph: 'RAR', label: 'RAR archive', family: 'archive' },
    'archive-gzip': { key: 'gzip', glyph: 'GZ', label: 'Gzip archive', family: 'archive' },
    'audio-flac': { key: 'flac', glyph: 'FL', label: 'FLAC audio', family: 'audio' },
    'audio-ogg': { key: 'ogg', glyph: 'OGG', label: 'Ogg media', family: 'audio' },
    'video-mpegts': { key: 'mpegts', glyph: 'TS', label: 'MPEG transport stream', family: 'video' },
  });

  const GENERIC_EXTENSION_ICONS = Object.freeze([
    ['pdf','PDF','PDF document','pdf',['.pdf']],
    ['spreadsheet','XLS','Spreadsheet','spreadsheet',['.xls','.xlsx','.xlsm','.xlsb','.ods','.ots','.csv','.tsv','.numbers']],
    ['presentation','PPT','Presentation','presentation',['.ppt','.pptx','.pptm','.odp','.key']],
    ['document','DOC','Document','document',['.doc','.docx','.docm','.dot','.dotx','.odt','.ott','.rtf','.txt','.text','.md','.markdown','.rst','.tex','.latex','.pages','.chm']],
    ['ebook','EBK','E-book','document',['.epub','.mobi','.azw','.azw3','.fb2']],
    ['video','▶','Video','video',['.mkv','.mp4','.avi','.mov','.webm','.wmv','.m4v','.mpeg','.mpg','.mpe','.ts','.m2ts','.mts','.flv','.f4v','.ogv','.3gp','.3g2','.vob','.asf','.rm','.rmvb','.divx']],
    ['audio','♪','Audio','audio',['.mp3','.flac','.wav','.wave','.m4a','.aac','.ogg','.oga','.opus','.wma','.alac','.aiff','.aif','.ape','.mid','.midi','.amr','.ac3','.dts','.mka']],
    ['image','IMG','Image','image',['.png','.jpg','.jpeg','.jpe','.gif','.webp','.bmp','.dib','.tif','.tiff','.svg','.svgz','.ico','.icns','.heic','.heif','.avif','.jxl','.raw','.cr2','.cr3','.nef','.arw','.dng','.orf','.rw2','.psd','.xcf','.kra','.ai','.eps']],
    ['archive','ARC','Archive','archive',['.zip','.7z','.rar','.tar','.gz','.bz2','.xz','.zst','.tgz','.tbz','.tbz2','.txz','.cab','.arj','.lha','.lzh','.ace','.cpio','.lz','.lzma']],
    ['disk','DSK','Disk image','disk',['.iso','.vhd','.vhdx','.vmdk','.qcow','.qcow2','.img','.dmg','.toast','.nrg','.wim','.esd','.ova','.ovf','.vdi','.vfd','.hdd','.pvm']],
    ['executable','EXE','Executable / script','executable',['.exe','.com','.scr','.cpl','.appimage','.desktop','.run']],
    ['package','PKG','Installer / package','package',['.msi','.msix','.msixbundle','.appx','.appxbundle','.deb','.rpm','.apk','.pkg']],
    ['library','LIB','Library / object','library',['.dll','.so','.dylib','.a','.lib','.sys','.ko','.o','.obj','.pdb','.class','.jar','.framework','.wasm']],
    ['database','DB','Database','database',['.db','.sqlite','.sqlite3','.mdb','.accdb','.dbf','.parquet','.avro','.orc']],
    ['font','Aa','Font','font',['.ttf','.otf','.woff','.woff2','.eot','.fon']],
    ['model','3D','3D / CAD','model',['.blend','.fbx','.obj','.stl','.3mf','.gltf','.glb','.dae','.step','.stp','.iges','.igs','.dwg','.dxf']],
    ['subtitle','SUB','Subtitle','subtitle',['.srt','.ass','.ssa','.sub','.vtt','.smi','.sami','.sup']],
    ['certificate','CRT','Certificate / key','config',['.cer','.crt','.pem','.der','.pfx','.p12','.keychain']],
    ['game','GAME','Game / application data','binary',['.pak','.pck','.wad','.bsa','.ba2','.vpk','.uasset','.umap','.dds','.bundle','.asset','.assets','.sav','.save','.gam','.rom','.nes','.sfc','.smc','.gba','.nds','.3ds','.cia','.xci','.nsp']],
    ['data','DAT','Data','binary',['.dat','.bin','.cache','.log','.torrent']],
  ]);

  const GENERIC_ICON_BY_EXTENSION = new Map();
  for (const [key, glyph, label, family, extensions] of GENERIC_EXTENSION_ICONS) {
    for (const extension of extensions) {
      if (!GENERIC_ICON_BY_EXTENSION.has(extension)) GENERIC_ICON_BY_EXTENSION.set(extension, { key, glyph, label, family });
    }
  }

  let categoryCacheKey = null;
  let categoryCache = null;
  const VIEW_CONTEXT = Object.freeze({
    directory: ['Directory', 'Browse the hierarchy and compare every item against the complete scan.', 'Ctrl+1'],
    largest: ['Largest Files', 'Rank the biggest individual files using the active Logical/Allocated size basis.', 'Ctrl+2'],
    duplicates: ['Duplicates', 'Find exact duplicate file contents with staged filtering and byte verification.', 'Ctrl+3'],
    search: ['Search', 'Filter the completed scan without touching the filesystem again.', 'Ctrl+4'],
    compare: ['Compare', 'Compare the current model with a saved .dmscan snapshot and inspect what changed.', 'Ctrl+5'],
    statistics: ['Statistics', 'Review distributions, filesystem context, and deterministic storage insights.', 'Ctrl+6'],
    history: ['History Explorer', 'Inspect bounded SQLite time-series history and compare stored snapshots.', 'Ctrl+7'],
    age: ['Age Analysis', 'Analyze logical and allocated storage by last-modified age; unknown timestamps remain explicit.', ''],
    cleanup: ['Cleanup Candidates', 'Review deterministic candidates with evidence. Nothing is deleted automatically.', ''],
    allocation: ['Allocation Efficiency', 'Inspect sparse/compressed metadata and logical-versus-allocated anomalies.', ''],
    reports: ['Reports', 'Export self-contained offline HTML plus structured JSON, CSV, and Markdown summaries.', ''],
    issues: ['Issues', 'Group non-fatal scan completeness and filesystem issues by category.', ''],
    diagnostics: ['Diagnostics', 'Review privacy-safe local application, engine, database, watcher, and sandbox state.', ''],
  });


  function normalizeCategoryExtension(value) {
    const ext = String(value || '').trim().toLowerCase();
    if (!ext || ext === '(none)') return '';
    return ext.startsWith('.') ? ext : `.${ext}`;
  }

  function buildCategoryModel() {
    const overrideRules = String(state.settings?.fileTypeOverrides || '').split(/\r?\n/).map(line => { const p=line.split('|').map(v=>v.trim()); return p.length>=2 && p[0] && p[1] ? `${p[1]} | ${p[2] || '#687786'} | ${p[0]}` : ''; }).filter(Boolean).join('\n');
    const rulesText = `${String(state.settings?.categoryRules || '')}\n${overrideRules}`;
    if (categoryCache && categoryCacheKey === rulesText) return categoryCache;

    const categories = DEFAULT_FILE_CATEGORIES.map(category => ({
      name: category.name, color: category.color, extensions: [...category.extensions], custom: false,
    }));
    const byName = new Map(categories.map(category => [category.name.toLowerCase(), category]));

    // Fold the comprehensive built-in recognition table into the existing
    // category model without changing the user's category-rule syntax.
    for (const [categoryName, extensions] of Object.entries(fileTypes?.categoryExtensions || {})) {
      const category = byName.get(categoryName.toLowerCase());
      if (!category) continue;
      for (const extension of extensions) {
        const normalized = normalizeCategoryExtension(extension);
        if (normalized && !category.extensions.includes(normalized)) category.extensions.push(normalized);
      }
    }

    const explicitExtensionOwners = new Map();
    const warnings = [];

    for (const [index, rawLine] of rulesText.split(/\r?\n/).entries()) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#') || line.startsWith('//')) continue;
      const parts = line.split('|').map(part => part.trim());
      if (parts.length < 2 || !parts[0]) {
        warnings.push(`Line ${index + 1}: expected Category | #RRGGBB | .ext, .ext2`);
        continue;
      }
      const name = parts[0];
      const color = parts[1];
      if (!/^#[0-9a-f]{6}$/i.test(color)) {
        warnings.push(`Line ${index + 1}: invalid color ${color || '(empty)'}`);
        continue;
      }
      const extensions = (parts.slice(2).join('|') || '').split(',')
        .map(normalizeCategoryExtension).filter(Boolean);
      let category = byName.get(name.toLowerCase());
      if (!category) {
        category = { name, color, extensions: [], custom: true };
        categories.splice(Math.max(0, categories.length - 1), 0, category);
        byName.set(name.toLowerCase(), category);
      } else {
        category.color = color;
        category.custom = true;
      }
      for (const extension of extensions) {
        explicitExtensionOwners.set(extension, category);
        if (!category.extensions.includes(extension)) category.extensions.push(extension);
      }
    }

    const extensionMap = new Map();
    for (const category of categories) {
      for (const extension of category.extensions) {
        if (!explicitExtensionOwners.has(extension)) extensionMap.set(extension, category);
      }
    }
    // Resolve built-in ambiguities using the comprehensive file-type table.
    for (const [categoryName, extensions] of Object.entries(fileTypes?.categoryExtensions || {})) {
      const category = byName.get(categoryName.toLowerCase());
      if (!category) continue;
      for (const extension of extensions) {
        if (!explicitExtensionOwners.has(extension)) extensionMap.set(extension, category);
      }
    }
    for (const [extension, category] of explicitExtensionOwners) extensionMap.set(extension, category);
    const other = byName.get('other') || categories[categories.length - 1];
    categoryCacheKey = rulesText;
    categoryCache = { categories, extensionMap, customExtensionMap: explicitExtensionOwners, other, warnings };
    return categoryCache;
  }

  function categoryForExtension(extension) {
    const model = buildCategoryModel();
    return model.extensionMap.get(normalizeCategoryExtension(extension)) || model.other;
  }

  function categoryNamed(name) {
    const model = buildCategoryModel();
    return model.categories.find(category => category.name === name) || model.other;
  }

  function categoryForNode(node) {
    if (!node) return categoryForExtension('');
    const hint = String(node.type_hint || '');
    const resolvedExtension = fileTypes?.extensionForName(node.name, node.extension) || normalizeCategoryExtension(node.extension);
    const model = buildCategoryModel();

    // User-authored rules remain the highest-priority category override.
    if (resolvedExtension && model.customExtensionMap?.has(resolvedExtension)) {
      return model.customExtensionMap.get(resolvedExtension);
    }

    // The comprehensive file-type table resolves ambiguous extensions with
    // source-code/toolchain mappings taking priority (for example .ts).
    const builtInCategory = fileTypes?.categoryForNode(node);
    if (builtInCategory) return categoryNamed(builtInCategory);
    if (resolvedExtension) return categoryForExtension(resolvedExtension);

    if (hint.startsWith('code-') || hint.startsWith('script-') || ['makefile','dockerfile','cmake','config'].includes(hint)) return categoryNamed('Development');
    if (['elf','pe-executable','mach-o','executable'].includes(hint)) return categoryNamed('Executables');
    if (hint === 'pdf' || hint === 'text') return categoryNamed('Documents');
    if (hint === 'sqlite') return categoryNamed('Data / game assets');
    if (hint.startsWith('image-')) return categoryNamed('Images');
    if (hint.startsWith('archive-')) return categoryNamed('Archives');
    if (hint.startsWith('audio-')) return categoryNamed('Audio');
    if (hint.startsWith('video-')) return categoryNamed('Video');
    return categoryForExtension('');
  }

  function customFileTypeOverride(node) {
    const ext = normalizeCategoryExtension(fileTypes?.extensionForName(node?.name, node?.extension) || node?.extension);
    if (!ext) return null;
    const allowedFamilies = new Set(['text','document','code','archive','image','audio','video','disk','binary','executable','library','subtitle','other']);
    for (const rawLine of String(state.settings?.fileTypeOverrides || '').split(/\r?\n/)) {
      const parts=rawLine.split('|').map(value=>value.trim());
      if (normalizeCategoryExtension(parts[0]) !== ext) continue;
      const category=parts[1] || categoryForExtension(ext).name;
      const family=allowedFamilies.has(String(parts[3]||'').toLowerCase()) ? String(parts[3]).toLowerCase() : null;
      if (!family) return null;
      const glyphByFamily={text:'TXT',document:'DOC',code:'SRC',archive:'ARC',image:'IMG',audio:'♪',video:'▶',disk:'DSK',binary:'DAT',executable:'EXE',library:'LIB',subtitle:'SUB',other:'?'};
      return {key:`custom-${family}`,glyph:glyphByFamily[family]||'?',label:category,family};
    }
    return null;
  }

  function iconDescriptorForNode(node) {
    if (!node) return { key: 'other', glyph: '?', label: 'File', family: 'other' };
    if (node.kind === 'directory') return { key: 'directory', glyph: '', label: 'Directory', family: 'directory' };
    if (node.kind === 'symlink') return { key: 'symlink', glyph: '', label: 'Symlink', family: 'other' };

    const extension = normalizeCategoryExtension(fileTypes?.extensionForName(node?.name, node?.extension) || node?.extension);
    const shortcutDescriptor = shortcutDescriptorForExtension(extension);
    if (shortcutDescriptor) return shortcutDescriptor;

    const customOverride=customFileTypeOverride(node); if(customOverride)return customOverride;
    const comprehensive = fileTypes?.descriptorForNode(node);
    if (comprehensive) return comprehensive;

    const hint = String(node.type_hint || '');
    if (hint && TYPE_HINT_ICONS[hint]) return TYPE_HINT_ICONS[hint];
    if (CODE_ICON_BY_EXTENSION.has(extension)) return CODE_ICON_BY_EXTENSION.get(extension);
    if (GENERIC_ICON_BY_EXTENSION.has(extension)) return GENERIC_ICON_BY_EXTENSION.get(extension);

    const category = categoryForNode(node);
    const familyByCategory = {
      Video: ['video','▶'], Audio: ['audio','♪'], Images: ['image','IMG'], Archives: ['archive','ARC'],
      'Disk images': ['disk','DSK'], Documents: ['document','DOC'], Executables: ['executable','EXE'],
      Libraries: ['library','LIB'], Development: ['code','SRC'], Subtitles: ['subtitle','SUB'],
      'Data / game assets': ['binary','DAT'], Other: ['other','?'],
    };
    const [family, glyph] = familyByCategory[category.name] || ['other','?'];
    return { key: family, glyph, label: category.name, family };
  }

  const SPECIAL_DIRECTORY_ICONS = Object.freeze({
    // Windows known/user folders and their common display-name variants.
    documents: { key: 'documents', glyph: 'DOC', label: 'Documents' },
    document: { key: 'documents', glyph: 'DOC', label: 'Documents' },
    mydocuments: { key: 'documents', glyph: 'DOC', label: 'Documents' },
    downloads: { key: 'downloads', glyph: 'DL', label: 'Downloads' },
    download: { key: 'downloads', glyph: 'DL', label: 'Downloads' },
    mydownloads: { key: 'downloads', glyph: 'DL', label: 'Downloads' },
    pictures: { key: 'pictures', glyph: 'IMG', label: 'Pictures' },
    picture: { key: 'pictures', glyph: 'IMG', label: 'Pictures' },
    mypictures: { key: 'pictures', glyph: 'IMG', label: 'Pictures' },
    gallery: { key: 'pictures', glyph: 'IMG', label: 'Gallery / Pictures' },
    galleries: { key: 'pictures', glyph: 'IMG', label: 'Gallery / Pictures' },
    photos: { key: 'pictures', glyph: 'IMG', label: 'Photos / Pictures' },
    images: { key: 'pictures', glyph: 'IMG', label: 'Images / Pictures' },
    cameraroll: { key: 'pictures', glyph: 'CAM', label: 'Camera Roll' },
    screenshots: { key: 'pictures', glyph: 'SHOT', label: 'Screenshots' },
    savedpictures: { key: 'pictures', glyph: 'IMG', label: 'Saved Pictures' },
    dcim: { key: 'pictures', glyph: 'CAM', label: 'Camera media / DCIM' },
    music: { key: 'music', glyph: '♪', label: 'Music' },
    mymusic: { key: 'music', glyph: '♪', label: 'Music' },
    audio: { key: 'music', glyph: '♪', label: 'Audio / Music' },
    videos: { key: 'videos', glyph: 'VID', label: 'Videos' },
    video: { key: 'videos', glyph: 'VID', label: 'Videos' },
    myvideos: { key: 'videos', glyph: 'VID', label: 'Videos' },
    movies: { key: 'videos', glyph: 'VID', label: 'Videos / Movies' },
    desktop: { key: 'desktop', glyph: 'PC', label: 'Desktop' },
    favorites: { key: 'favorites', glyph: '★', label: 'Favorites' },
    favourites: { key: 'favorites', glyph: '★', label: 'Favorites' },
    links: { key: 'links', glyph: '↗', label: 'Links / Shortcuts' },
    contacts: { key: 'contacts', glyph: '@', label: 'Contacts' },
    savedgames: { key: 'games', glyph: 'GAME', label: 'Saved Games' },
    searches: { key: 'searches', glyph: '?', label: 'Saved Searches' },
    '3dobjects': { key: 'objects3d', glyph: '3D', label: '3D Objects' },
    templates: { key: 'templates', glyph: 'TPL', label: 'Templates' },
    startmenu: { key: 'system', glyph: 'WIN', label: 'Start Menu' },
    startup: { key: 'system', glyph: 'RUN', label: 'Startup' },
    programs: { key: 'system', glyph: 'APP', label: 'Programs' },
    sendto: { key: 'links', glyph: '→', label: 'SendTo' },
    recent: { key: 'recent', glyph: '⟳', label: 'Recent Items' },
    public: { key: 'public', glyph: 'PUB', label: 'Public' },
    publicdesktop: { key: 'desktop', glyph: 'PC', label: 'Public Desktop' },
    publicdocuments: { key: 'documents', glyph: 'DOC', label: 'Public Documents' },
    shareddocuments: { key: 'documents', glyph: 'DOC', label: 'Shared Documents' },
    publicdownloads: { key: 'downloads', glyph: 'DL', label: 'Public Downloads' },
    publicmusic: { key: 'music', glyph: '♪', label: 'Public Music' },
    sharedmusic: { key: 'music', glyph: '♪', label: 'Shared Music' },
    publicpictures: { key: 'pictures', glyph: 'IMG', label: 'Public Pictures' },
    sharedpictures: { key: 'pictures', glyph: 'IMG', label: 'Shared Pictures' },
    publicvideos: { key: 'videos', glyph: 'VID', label: 'Public Videos' },
    sharedvideos: { key: 'videos', glyph: 'VID', label: 'Shared Videos' },
    onedrive: { key: 'cloud-local', glyph: '1D', label: 'OneDrive folder' },
    iclouddrive: { key: 'cloud-local', glyph: 'iC', label: 'iCloud Drive folder' },

    // Freedesktop/XDG conventional user folders and common local system folders.
    home: { key: 'home', glyph: '⌂', label: 'Home' },
    publicshare: { key: 'public', glyph: 'PUB', label: 'Public Share' },
    trash: { key: 'trash', glyph: 'BIN', label: 'Trash' },
    recyclebin: { key: 'trash', glyph: 'BIN', label: 'Recycle Bin' },
    bin: { key: 'system', glyph: 'BIN', label: 'Binary programs' },
    sbin: { key: 'system', glyph: 'BIN', label: 'System programs' },
    usr: { key: 'system', glyph: 'SYS', label: 'System data' },
    etc: { key: 'system', glyph: 'CFG', label: 'System configuration' },
    var: { key: 'system', glyph: 'VAR', label: 'Variable system data' },
    opt: { key: 'system', glyph: 'OPT', label: 'Optional software' },
    dev: { key: 'system', glyph: 'DEV', label: 'Devices' },
    proc: { key: 'system', glyph: 'PROC', label: 'Process filesystem' },
    sys: { key: 'system', glyph: 'SYS', label: 'System filesystem' },
    run: { key: 'system', glyph: 'RUN', label: 'Runtime data' },
    mnt: { key: 'mount', glyph: 'MNT', label: 'Mount points' },
    media: { key: 'mount', glyph: 'MNT', label: 'Removable media' },
    lostfound: { key: 'system', glyph: 'FS', label: 'Filesystem recovery directory' },
    config: { key: 'config', glyph: 'CFG', label: 'Configuration' },
    cache: { key: 'cache', glyph: 'TMP', label: 'Cache' },
    local: { key: 'local', glyph: 'USR', label: 'Local user data' },
  });

  function normalizedLocationToken(value) {
    return String(value || '').trim().toLowerCase().replace(/[\s._-]+/g, '');
  }

  function specialDirectoryDescriptor(node) {
    if (!node || node.kind !== 'directory') return null;
    const direct = SPECIAL_DIRECTORY_ICONS[normalizedLocationToken(node.name)];
    if (direct) return direct;
    const tail = String(node.path || '').split(/[\\/]+/).filter(Boolean).pop() || '';
    return SPECIAL_DIRECTORY_ICONS[normalizedLocationToken(tail)] || null;
  }

  function shortcutDescriptorForExtension(extension) {
    if (!extension) return null;
    const normalized = String(extension).toLowerCase();
    if (['.lnk', '.url', '.webloc', '.desktop', '.appref-ms', '.website', '.alias', '.library-ms', '.search-ms', '.searchconnector-ms'].includes(normalized)) {
      const launcher = ['.desktop', '.appref-ms'].includes(normalized);
      return { key: 'shortcut', glyph: launcher ? 'APP' : 'LNK', label: launcher ? 'Launcher / shortcut' : 'Shortcut / link', family: 'shortcut' };
    }
    return null;
  }

  function makeFileIcon(node) {
    const specialDirectory = specialDirectoryDescriptor(node);
    if (specialDirectory) {
      const icon = el('span', `file-icon directory special-folder folder-${specialDirectory.key}`);
      icon.dataset.glyph = specialDirectory.glyph;
      icon.title = specialDirectory.label;
      icon.setAttribute('aria-hidden', 'true');
      return icon;
    }
    if (node?.kind === 'directory') {
      const icon = el('span', 'file-icon directory');
      icon.setAttribute('aria-hidden', 'true');
      return icon;
    }
    if (node?.kind === 'symlink') {
      const icon = el('span', 'file-icon symlink');
      icon.setAttribute('aria-hidden', 'true');
      return icon;
    }
    const descriptor = iconDescriptorForNode(node);
    const icon = el('span', `file-icon file-type icon-${descriptor.family} type-${descriptor.key}`);
    icon.dataset.glyph = descriptor.glyph;
    icon.title = descriptor.label;
    icon.setAttribute('aria-hidden', 'true');
    return icon;
  }

  function detectedTypeLabel(node) {
    if (!node) return '—';
    const extension = normalizeCategoryExtension(fileTypes?.extensionForName(node?.name, node?.extension) || node?.extension);
    const shortcutDescriptor = shortcutDescriptorForExtension(extension);
    if (shortcutDescriptor) return shortcutDescriptor.label;
    const comprehensive = fileTypes?.labelForNode(node);
    if (comprehensive) return comprehensive;
    const hint = String(node.type_hint || '');
    if (hint && TYPE_HINT_ICONS[hint]) return TYPE_HINT_ICONS[hint].label;
    return node.extension || node.kind;
  }

  function recognizedExtension(node) {
    return fileTypes?.extensionForName(node?.name, node?.extension) || node?.extension || '';
  }


  class VirtualList {
    constructor(element, renderRow, rowHeight = 31) {
      this.element = element;
      this.renderRow = renderRow;
      this.rowHeight = rowHeight;
      this.rows = [];
      this.spacer = document.createElement('div');
      this.spacer.className = 'virtual-spacer';
      this.layer = document.createElement('div');
      this.layer.className = 'virtual-layer';
      this.spacer.appendChild(this.layer);
      element.replaceChildren(this.spacer);
      element.addEventListener('scroll', () => this.render(), { passive: true });
      new ResizeObserver(() => this.render()).observe(element);
    }

    setRows(rows) {
      this.rows = rows || [];
      this.spacer.style.height = `${this.rows.length * this.rowHeight}px`;
      this.render();
    }

    refresh() { this.render(); }

    scrollToIndex(index) {
      if (index < 0) return;
      const top = index * this.rowHeight;
      const bottom = top + this.rowHeight;
      if (top < this.element.scrollTop) this.element.scrollTop = top;
      else if (bottom > this.element.scrollTop + this.element.clientHeight) {
        this.element.scrollTop = bottom - this.element.clientHeight;
      }
      this.render();
    }

    render() {
      const height = Math.max(this.element.clientHeight, 1);
      const start = Math.max(0, Math.floor(this.element.scrollTop / this.rowHeight) - 8);
      const count = Math.ceil(height / this.rowHeight) + 16;
      const end = Math.min(this.rows.length, start + count);
      this.layer.style.transform = `translateY(${start * this.rowHeight}px)`;
      const fragment = document.createDocumentFragment();
      for (let i = start; i < end; i += 1) {
        const row = this.renderRow(this.rows[i], i);
        if (row) fragment.appendChild(row);
      }
      this.layer.replaceChildren(fragment);
    }
  }

  const treeList = new VirtualList($('treeList'), renderTreeRow);
  const largestList = new VirtualList($('largestList'), (row) => renderResultRow(row, 'largest-row'));
  const searchList = new VirtualList($('searchList'), (row) => renderResultRow(row, 'search-row'));
  const duplicateList = new VirtualList($('duplicateList'), renderDuplicateRow);
  const compareList = new VirtualList($('compareList'), renderComparisonRow);
  const extensionList = new VirtualList($('extensionList'), renderExtensionRow);

  const TREE_SHARE_BAND_COUNT = 4;

  function normalizeTreeShareBandColors(value) {
    const defaults = defaultSettings.treeShareBandColors;
    if (!Array.isArray(value) || value.length !== TREE_SHARE_BAND_COUNT) return [...defaults];
    const colors = value.map(color => String(color || '').trim().toLowerCase());
    if (colors.some(color => !/^#[0-9a-f]{6}$/.test(color))) return [...defaults];
    return colors;
  }

  function normalizeTreeShareBandMaxima(value) {
    const defaults = defaultSettings.treeShareBandMaxima;
    if (!Array.isArray(value) || value.length !== TREE_SHARE_BAND_COUNT) return [...defaults];
    const maxima = value.map(Number);
    const valid = maxima.every((number, index) => Number.isFinite(number) && number >= 0 && number <= 100 && (index === 0 || number > maxima[index - 1]));
    if (!valid || maxima[TREE_SHARE_BAND_COUNT - 1] !== 100) return [...defaults];
    return maxima;
  }

  function treeShareBandColor(percent) {
    const colors = normalizeTreeShareBandColors(state.settings?.treeShareBandColors);
    const maxima = normalizeTreeShareBandMaxima(state.settings?.treeShareBandMaxima);
    const pct = Math.max(0, Math.min(100, Number(percent) || 0));
    const index = maxima.findIndex(maximum => pct <= maximum);
    return colors[index < 0 ? TREE_SHARE_BAND_COUNT - 1 : index];
  }

  function loadSettings() {
    try {
      const raw = JSON.parse(localStorage.getItem('diskmosaic.settings') || '{}');
      const settings = { ...defaultSettings, ...raw };
      settings.treeShareBandColorsEnabled = raw.treeShareBandColorsEnabled === true;
      settings.treeShareBandColors = normalizeTreeShareBandColors(raw.treeShareBandColors ?? defaultSettings.treeShareBandColors);
      settings.treeShareBandMaxima = normalizeTreeShareBandMaxima(raw.treeShareBandMaxima ?? defaultSettings.treeShareBandMaxima);
      settings.treeColumns = { ...defaultSettings.treeColumns, ...(raw.treeColumns || {}) };
      // Migrate the original 1.0.0 visualizer defaults without overriding values
      // that a user clearly customized. This gives existing installs the larger,
      // calmer treemap on first launch after the visualizer refresh.
      if (raw.visualizerRevision !== defaultSettings.visualizerRevision) {
        if (raw.topHeight == null || Number(raw.topHeight) === 55) settings.topHeight = defaultSettings.topHeight;
        if (raw.treemapMaxItems == null || Number(raw.treemapMaxItems) === 3000) settings.treemapMaxItems = defaultSettings.treemapMaxItems;
        if (raw.treemapMinPx == null || Number(raw.treemapMinPx) === 3) settings.treemapMinPx = defaultSettings.treemapMinPx;
        if (raw.treemapCushion == null) settings.treemapCushion = true;
        if (raw.treemapCushionStrength == null) settings.treemapCushionStrength = defaultSettings.treemapCushionStrength;
        if (raw.treemapColorMode == null) settings.treemapColorMode = defaultSettings.treemapColorMode;
        if (raw.excludePatterns == null) settings.excludePatterns = '';
        settings.visualizerRevision = defaultSettings.visualizerRevision;
        localStorage.setItem('diskmosaic.settings', JSON.stringify(settings));
      }
      return settings;
    } catch (_) {
      return { ...defaultSettings };
    }
  }

  function saveSettings(settings) {
    state.settings = { ...defaultSettings, ...settings };
    state.settings.treeShareBandColorsEnabled = state.settings.treeShareBandColorsEnabled === true;
    state.settings.treeShareBandColors = normalizeTreeShareBandColors(state.settings.treeShareBandColors);
    state.settings.treeShareBandMaxima = normalizeTreeShareBandMaxima(state.settings.treeShareBandMaxima);
    state.settings.treeColumns = { ...defaultSettings.treeColumns, ...(state.settings.treeColumns || {}) };
    state.settings.treeColumnOrder = normalizeTreeColumnOrder(state.settings.treeColumnOrder);
    state.settings.treeColumnWidths = { ...defaultSettings.treeColumnWidths, ...(state.settings.treeColumnWidths || {}) };
    localStorage.setItem('diskmosaic.settings', JSON.stringify(state.settings));
    applySettings();
  }

  const TREE_COLUMN_KEYS = ['name','logical','allocated','share','files','directories','modified','owner','permissions'];

  function normalizeTreeColumnOrder(order) {
    const clean = Array.isArray(order) ? order.filter((value, index) => TREE_COLUMN_KEYS.includes(value) && order.indexOf(value) === index) : [];
    for (const key of TREE_COLUMN_KEYS) if (!clean.includes(key)) clean.push(key);
    if (clean[0] !== 'name') { clean.splice(clean.indexOf('name'), 1); clean.unshift('name'); }
    return clean;
  }

  function applyTreeColumnVisibility() {
    const columns = { ...defaultSettings.treeColumns, ...(state.settings?.treeColumns || {}) };
    const root = document.documentElement;
    for (const [name, visible] of Object.entries(columns)) root.classList.toggle(`hide-tree-${name}`, !visible);
    applyTreeColumnLayout();
  }

  function applyTreeColumnLayout() {
    const order = normalizeTreeColumnOrder(state.settings?.treeColumnOrder);
    const widths = { ...defaultSettings.treeColumnWidths, ...(state.settings?.treeColumnWidths || {}) };
    const visible = { ...defaultSettings.treeColumns, ...(state.settings?.treeColumns || {}) };
    const cssParts = [];
    let minimumWidth = 16; // Reserve the vertical scrollbar gutter.
    for (const key of order) {
      if (key !== 'name' && visible[key] === false) continue;
      const width = clamp(widths[key] || defaultSettings.treeColumnWidths[key] || 90, window.DiskMosaicLayout.columnMinimum(key), key === 'name' ? 800 : 360);
      minimumWidth += width;
      cssParts.push(key === 'name' ? `minmax(${width}px, 1fr)` : `${width}px`);
    }
    document.documentElement.style.setProperty('--tree-grid-template', cssParts.join(' '));
    document.documentElement.style.setProperty('--tree-table-min-width', `${minimumWidth}px`);
    document.querySelectorAll('[data-tree-column]').forEach(cell => {
      const index = order.indexOf(cell.dataset.treeColumn);
      cell.style.order = String(index < 0 ? 99 : index);
    });
    if (treeList?.layer) treeList.layer.querySelectorAll('[data-tree-column]').forEach(cell => {
      const index = order.indexOf(cell.dataset.treeColumn);
      cell.style.order = String(index < 0 ? 99 : index);
    });
  }

  function applyTreePreset(name, persist = true) {
    const presets = {
      compact: { logical: true, allocated: false, share: true, files: false, directories: false, modified: false, owner: false, permissions: false },
      sizes: { logical: true, allocated: true, share: true, files: true, directories: true, modified: false, owner: false, permissions: false },
      metadata: { logical: true, allocated: true, share: false, files: false, directories: false, modified: true, owner: true, permissions: false },
      permissions: { logical: false, allocated: false, share: false, files: false, directories: false, modified: true, owner: true, permissions: true },
      full: { logical: true, allocated: true, share: true, files: true, directories: true, modified: true, owner: true, permissions: true },
    };
    if (!presets[name]) return;
    state.settings.treeColumns = { ...presets[name] };
    applyTreeColumnVisibility();
    treeList.refresh();
    if (persist) localStorage.setItem('diskmosaic.settings', JSON.stringify(state.settings));
    syncTreeHeaderMenu();
  }

  function syncTreeHeaderMenu() {
    const cols = { ...defaultSettings.treeColumns, ...(state.settings.treeColumns || {}) };
    document.querySelectorAll('[data-tree-toggle]').forEach(input => { input.checked = cols[input.dataset.treeToggle] !== false; });
  }

  function applySettings() {
    const s = state.settings;
    i18n?.setLanguage(s.language || 'en');
    api.setLanguage?.(s.language || 'en').catch(() => {});
    state.sizeBasis = s.sizeBasis === 'allocated' ? 'allocated' : 'logical';
    updateSizeBasisButtons();
    if (s.theme === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.dataset.theme = s.theme;
    const reduceMotion = s.reducedMotion === true || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    document.documentElement.classList.toggle('animations-off', !s.animation || reduceMotion);
    document.documentElement.classList.toggle('high-contrast-focus', s.highContrastFocus === true);
    document.documentElement.classList.toggle('alternating-rows', s.alternatingRows === true);
    document.documentElement.style.setProperty('--tree-width', `${clamp(s.treeWidth, 50, 78)}%`);
    document.documentElement.style.setProperty('--top-height', `${clamp(s.topHeight, 30, 75)}%`);
    applyTreeColumnVisibility();
    treeList.refresh();
    extensionList.refresh();
    largestList.refresh();
    searchList.refresh();
    duplicateList.refresh();
    compareList.refresh();
    renderStatistics();
    drawTreemap();
  }

  function clamp(value, min, max) { return Math.max(min, Math.min(max, Number(value))); }

  function basisSize(node) {
    if (!node) return 0;
    return state.sizeBasis === 'allocated' ? Number(node.allocated_size || 0) : Number(node.size || 0);
  }

  function hiddenDisplayMode() {
    const mode = state.settings?.hiddenDisplayMode;
    return mode === 'directories_only' || mode === 'hide_all' ? mode : 'show_all';
  }

  function rootBasisSize() {
    if (state.sizeBasis === 'allocated') return Number(state.summary?.allocated_bytes ?? state.rootNode?.allocated_size ?? 0);
    return Number(state.summary?.bytes ?? state.rootNode?.size ?? 0);
  }

  function updateSizeBasisButtons() {
    const logical = $('logicalBasisButton');
    const allocated = $('allocatedBasisButton');
    if (!logical || !allocated) return;
    logical.classList.toggle('active', state.sizeBasis === 'logical');
    allocated.classList.toggle('active', state.sizeBasis === 'allocated');
    const labelKey = state.sizeBasis === 'allocated' ? 'Allocated' : 'Logical';
    const label = t(labelKey);
    if ($('largestSizeHeader')) $('largestSizeHeader').textContent = `${label} ↓`;
    if ($('typeSizeHeader')) $('typeSizeHeader').textContent = `${label} ↓`;
    if ($('searchBasisHint')) $('searchBasisHint').textContent = t('Size filters use {basis} size', { basis: label });
  }

  async function setSizeBasis(basis) {
    const next = basis === 'allocated' ? 'allocated' : 'logical';
    if (state.sizeBasis === next) return;
    state.sizeBasis = next;
    state.settings.sizeBasis = next;
    localStorage.setItem('diskmosaic.settings', JSON.stringify(state.settings));
    updateSizeBasisButtons();
    treeList.refresh();
    largestList.refresh();
    searchList.refresh();
    duplicateList.refresh();
    compareList.refresh();
    renderDuplicateSummary();
    renderComparisonSummary();
    renderExtensions();
    updateDetails(state.selectedNode);
    updateScanSummaryStrip();
    renderStatistics();
    if (state.rootNode) await focusTreemap(state.treemapParent, false);
    const activeView = document.querySelector('.tab.active')?.dataset.view;
    if (activeView === 'largest') await loadLargest();
    if (activeView === 'search') await runSearch();
  }

  function loadPathList(key) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || '[]');
      return Array.isArray(value) ? value.filter(item => typeof item === 'string' && item.trim()).slice(0, 20) : [];
    } catch (_) { return []; }
  }

  function savePathList(key, values) {
    localStorage.setItem(key, JSON.stringify([...new Set(values.filter(Boolean))].slice(0, 20)));
  }

  function rememberRecent(path) {
    if (!path) return;
    const values = loadPathList('diskmosaic.recent').filter(item => item !== path);
    values.unshift(path);
    savePathList('diskmosaic.recent', values.slice(0, 8));
    renderSavedLocations();
  }

  function isBookmarked(path) { return !!path && loadPathList('diskmosaic.bookmarks').includes(path); }

  function setBookmark(path, enabled) {
    if (!path) return;
    let values = loadPathList('diskmosaic.bookmarks').filter(item => item !== path);
    if (enabled) values.unshift(path);
    savePathList('diskmosaic.bookmarks', values.slice(0, 20));
    updateBookmarkButton();
    renderSavedLocations();
  }

  function updateBookmarkButton() {
    const button = $('bookmarkButton');
    if (!button) return;
    button.disabled = !state.rootPath;
    const bookmarked = isBookmarked(state.rootPath);
    button.classList.toggle('bookmarked', bookmarked);
    button.textContent = bookmarked ? '★' : '☆';
    button.title = bookmarked ? 'Remove current scan location from bookmarks' : 'Bookmark current scan location';
  }

  function renderPathChoices(elementId, paths, bookmarked = false) {
    const host = $(elementId);
    if (!host) return;
    host.replaceChildren();
    if (!paths.length) {
      host.appendChild(el('span', 'muted', bookmarked ? 'No bookmarks yet.' : 'No recent scans yet.'));
      return;
    }
    for (const path of paths) {
      const button = el('button', 'saved-choice');
      button.type = 'button';
      button.title = path;
      if (bookmarked) button.appendChild(el('span', 'bookmark-star', '★'));
      const pathNode = { kind: 'directory', name: String(path).split(/[\\/]+/).filter(Boolean).pop() || String(path), path };
      button.appendChild(makeFileIcon(pathNode));
      const label = el('span', 'saved-choice-label', path);
      label.title = path;
      button.appendChild(label);
      button.addEventListener('click', () => startScan(path).catch(reportError));
      host.appendChild(button);
    }
  }

  function renderSavedLocations() {
    renderPathChoices('bookmarkChoices', loadPathList('diskmosaic.bookmarks'), true);
    renderPathChoices('recentChoices', loadPathList('diskmosaic.recent'), false);
  }

  function makeRequest(command, expected, timeoutMs = 15000) {
    const requestId = crypto.randomUUID();
    const expectedSet = new Set(Array.isArray(expected) ? expected : [expected]);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        state.pending.delete(requestId);
        reject(new Error(`Engine request timed out: ${command.cmd}`));
      }, timeoutMs);
      state.pending.set(requestId, { expectedSet, resolve, reject, timer });
      api.sendEngine({ ...command, request_id: requestId }).catch(error => {
        clearTimeout(timer);
        state.pending.delete(requestId);
        reject(error);
      });
    });
  }

  async function send(command) {
    const requestId = crypto.randomUUID();
    await api.sendEngine({ ...command, request_id: requestId });
    return requestId;
  }

  function settlePending(event) {
    if (!event.request_id) return;
    const pending = state.pending.get(event.request_id);
    if (!pending) return;
    if (event.event === 'operation_failed') {
      clearTimeout(pending.timer);
      state.pending.delete(event.request_id);
      pending.reject(new Error(event.message || 'Engine operation failed'));
      return;
    }
    if (pending.expectedSet.has(event.event)) {
      clearTimeout(pending.timer);
      state.pending.delete(event.request_id);
      pending.resolve(event);
    }
  }

  api.onEngineEvent(event => {
    settlePending(event);
    switch (event.event) {
      case 'engine_ready':
        state.engineReady = true;
        $('statusText').textContent = `Engine ready · protocol ${event.protocol}`;
        initializeStartup().catch(reportError);
        break;
      case 'scan_started':
        state.scanning = true;
        state.scanPaused = false;
        $('pauseButton').textContent = t('Pause');
        $('pauseButton').disabled = false;
        state.treemapHover = null;
        $('treemapHoverFrame').classList.add('hidden');
        $('treemapTooltip').classList.add('hidden');
        $('progressPanel').classList.remove('hidden');
        $('treemapScanOverlay').classList.remove('hidden');
        $('treemapEmpty').classList.add('hidden');
        $('cancelButton').disabled = false;
        $('rescanButton').disabled = true;
        $('startOverlay').classList.add('hidden');
        $('statusText').textContent = t('Scanning…');
        break;
      case 'scan_pause_changed':
        state.scanPaused = !!event.paused;
        $('pauseButton').textContent = state.scanPaused ? t('Resume') : t('Pause');
        $('statusText').textContent = state.scanPaused ? t('Scan paused') : t('Scanning…');
        break;
      case 'scan_progress':
        state.scanPaused = !!event.paused;
        $('pauseButton').textContent = state.scanPaused ? t('Resume') : t('Pause');
        updateProgress(event);
        break;
      case 'scan_completed':
        finishScan(event).catch(reportError);
        break;
      case 'scan_cancelled':
        state.scanning = false;
        state.scanPaused = false;
        $('pauseButton').disabled = true;
        $('progressPanel').classList.add('hidden');
        $('treemapScanOverlay').classList.add('hidden');
        $('treemapEmpty').classList.toggle('hidden', state.treemapItems.length > 0);
        $('rescanButton').disabled = !state.rootPath;
        $('statusText').textContent = t('Scan cancelled');
        toast(t('Scan cancelled.'));
        break;
      case 'scan_error':
        state.scanning = false;
        state.scanPaused = false;
        $('pauseButton').disabled = true;
        $('progressPanel').classList.add('hidden');
        $('treemapScanOverlay').classList.add('hidden');
        $('treemapEmpty').classList.toggle('hidden', state.treemapItems.length > 0);
        $('rescanButton').disabled = !state.rootPath;
        $('statusText').textContent = t('Scan failed');
        toast(event.message || t('Scan failed'), true);
        break;
      case 'duplicate_started':
        state.analyzing = true;
        $('duplicateAnalyzeButton').disabled = true;
        $('duplicateCancelButton').classList.remove('hidden');
        $('duplicateProgress').textContent = `${integer(event.candidate_files || 0)} candidate files in ${integer(event.size_groups || 0)} equal-size groups`;
        break;
      case 'duplicate_progress':
        $('duplicateProgress').textContent = `${integer(event.sample_hashed_files ?? event.hashed_files ?? 0)} sampled · ${integer(event.full_hashed_files || 0)} full hashes · ${integer(event.compared_files || 0)} exact comparisons · ${integer(event.groups_found || 0)} groups found${event.errors ? ` · ${integer(event.errors)} errors` : ''}`;
        break;
      case 'duplicate_completed':
        state.analyzing = false;
        state.duplicateResult = event.result || null;
        $('duplicateAnalyzeButton').disabled = false;
        $('duplicateCancelButton').classList.add('hidden');
        buildDuplicateRows();
        renderDuplicateSummary();
        $('duplicateProgress').textContent = event.result?.cancelled ? 'Duplicate analysis cancelled; partial verified results retained.' : 'Duplicate analysis complete.';
        renderStatistics();
        break;
      case 'analysis_cancel_requested':
        $('duplicateProgress').textContent = 'Cancelling background analysis…';
        break;
      case 'snapshot_saved':
        state.analyzing = false;
        state.snapshotPath = event.path || null;
        toast(`Saved scan snapshot: ${event.path}`);
        break;
      case 'snapshot_loaded':
        state.analyzing = false;
        state.snapshotPath = event.path || null;
        finishLoadedSnapshot(event).catch(reportError);
        break;
      case 'comparison_completed':
        state.analyzing = false;
        state.comparisonResult = event.result || null;
        state.comparisonRows = event.result?.changes || [];
        state.treemapMode = 'current';
        compareList.setRows(state.comparisonRows);
        $('comparePath').textContent = event.path || 'Saved scan';
        $('comparePath').title = event.path || '';
        renderComparisonSummary();
        renderStatistics();
        updateTreemapControls();
        drawTreemap();
        break;
      case 'selection_changed':
        state.selectedIds = new Set(event.selected_ids || []);
        state.selectionSummary = event.summary || null;
        state.selectionTruncated = !!event.truncated;
        updateScanSummaryStrip();
        treeList.refresh(); largestList.refresh(); searchList.refresh(); drawTreemap();
        updateSelectionInspector().catch(()=>{});
        break;
      case 'refresh_started':
        state.scanning = true;
        $('statusText').textContent = t('Refreshing selected directories…');
        break;
      case 'refresh_progress':
        $('statusText').textContent = `${t('Refreshing')}: ${event.path || ''}`;
        break;
      case 'refresh_completed':
        applyIncrementalRefresh(event).catch(reportError);
        break;
      case 'refresh_cancelled':
        state.scanning = false;
        $('statusText').textContent = t('Refresh cancelled');
        break;
      case 'watcher_state':
        setWatcherState(event.state || 'not_watching', event.message || '');
        break;
      case 'watcher_changes':
        if (!state.watcherRefreshPending && !state.scanning && Array.isArray(event.paths) && event.paths.length) {
          state.watcherRefreshPending = true;
          send({ cmd: 'refresh_paths', paths: event.paths }).catch(error => { state.watcherRefreshPending = false; reportError(error); });
        }
        break;
      case 'history_stored':
        state.analyzing = false;
        toast(t('Scan stored in local history.'));
        loadHistory().catch(reportError);
        if (state.settings.historyAutoRetention && state.settings.historyRetentionMode !== 'all') {
          const retention = retentionRequest(state.settings.historyRetentionMode, state.settings.historyKeepLast, state.settings.historyKeepMonths);
          send({ cmd: 'history_apply_retention', ...retention, automatic: true }).catch(reportError);
        }
        break;
      case 'history_loaded':
        state.analyzing = false;
        finishHistoryLoaded(event).catch(reportError);
        break;
      case 'history_deleted':
        toast(event.deleted ? t('History entry deleted.') : t('History entry was already absent.'));
        loadHistory().catch(reportError);
        break;
      case 'history_list':
        state.historyRows = event.items || [];
        renderHistory();
        $('historyStatusText').textContent = `${integer(event.total || 0)} ${t('stored scans')} · SQLite`;
        break;
      case 'batch_trash_completed':
        state.analyzing = false;
        toast(`${integer(event.succeeded || 0)} ${t('items moved to Trash')}${event.failed ? ` · ${integer(event.failed)} ${t('failed')}` : ''}`, !!event.failed);
        if (event.refresh_paths?.length) send({ cmd: 'refresh_paths', paths: event.refresh_paths }).catch(reportError);
        send({ cmd: 'selection_summary' }).catch(() => {});
        break;
      case 'hash_selection_completed':
        state.analyzing = false;
        saveHashResults(event).catch(reportError);
        break;
      case 'operation_completed':
        if (event.operation === 'trash') {
          toast(`Moved to Trash: ${event.path}`);
          const parent = event.path ? event.path.replace(/[\\/][^\\/]+$/, '') : '';
          if (parent) send({ cmd: 'refresh_paths', paths: [parent] }).catch(reportError);
        }
        break;
      case 'operation_failed':
        if (['duplicate_scan','save_snapshot','load_snapshot','compare_snapshot','history_store_current','history_load','compare_history','batch_trash','hash_selection'].includes(event.operation)) {
          state.analyzing = false;
          $('duplicateAnalyzeButton').disabled = false;
          $('duplicateCancelButton').classList.add('hidden');
        }
        if (['refresh_paths','refresh_selected'].includes(event.operation)) { state.scanning = false; state.watcherRefreshPending = false; }
        toast(event.message || 'Operation failed', true);
        break;
      case 'protocol_error':
      case 'engine_launch_error':
      case 'engine_exit':
        $('statusText').textContent = t('Engine error');
        toast(event.message || t('Rust engine communication error'), true);
        break;
      default:
        break;
    }
  });

  function setWatcherState(value, message = '') {
    state.watcherState = value;
    const badge = $('watchStatus');
    if (!badge) return;
    badge.classList.remove('watching', 'paused', 'stale', 'not-watching');
    const map = {
      watching: ['watching', 'Watching'], paused: ['paused', 'Paused'],
      overflow_refresh_required: ['stale', 'Refresh required'], not_watching: ['not-watching', 'Not watching'],
    };
    const [klass, label] = map[value] || map.not_watching;
    badge.classList.add(klass);
    badge.textContent = t(label);
    badge.title = message || t(value === 'overflow_refresh_required' ? 'Watcher overflow/event storm: data may be stale until refreshed.' : `Filesystem watcher: ${label}`);
  }

  async function startWatcher() {
    if (!state.rootNode || state.snapshotPath || !state.settings.watchFilesystem) return;
    await send({ cmd: 'watch_start', debounce_ms: Number(state.settings.watchDebounce) || 500 });
  }

  async function applyIncrementalRefresh(event) {
    state.scanning = false;
    state.watcherRefreshPending = false;
    if (event.root) state.rootNode = event.root;
    if (event.summary) state.summary = event.summary;
    if (event.extension_stats) state.extensionStats = event.extension_stats;
    if (event.statistics) state.statistics = event.statistics;
    state.duplicateResult = null;
    buildDuplicateRows();
    renderDuplicateSummary();
    updateScanSummaryStrip();
    renderExtensions();
    renderStatistics();
    await reloadTree();
    const target = state.treemapParentNode?.id ?? state.treemapParent ?? 0;
    try { await focusTreemap(target, false); } catch (_) { await focusTreemapRoot(); }
    await send({ cmd: 'selection_summary' }).catch(() => {});
    const changed = (event.reports || []).reduce((sum, report) => sum + Number(report.new_ids || 0) + Number(report.removed_ids || 0), 0);
    $('statusText').textContent = event.errors?.length
      ? t('Refresh completed with {count} errors', { count: integer(event.errors.length) })
      : t('Incremental refresh completed');
    if (changed) $('statusSummary').textContent = `${integer(changed)} ${t('model changes reconciled without a full-root rescan')}`;
    if (state.settings.watchFilesystem && !state.snapshotPath) send({ cmd: 'watch_status' }).catch(() => {});
  }

  async function finishHistoryLoaded(event) {
    await finishScan({ ...event, event: 'scan_completed', saved_source: true });
    state.snapshotPath = `history:${event.entry?.id ?? ''}`;
    updateScanSummaryStrip();
    setWatcherState('not_watching');
    $('statusText').textContent = t('History scan loaded');
    toast(t('Loaded scan from local history.'));
  }

  async function loadHistory() {
    if (!state.engineReady) return;
    const response = await makeRequest({ cmd: 'history_list', offset: 0, limit: 200 }, 'history_list', 30000);
    state.historyRows = response.items || [];
    renderHistory();
    $('historyStatusText').textContent = `${integer(response.total || 0)} ${t('stored scans')} · SQLite`;
  }

  function renderHistory() {
    const host = $('historyList');
    if (!host) return;
    if (!state.historyRows.length) {
      host.replaceChildren(el('div', 'empty-state', t('No scans have been stored in local history yet.')));
      return;
    }
    const frag = document.createDocumentFragment();
    for (const entry of state.historyRows) {
      const row = el('div', 'history-row');
      const root = el('span', '', entry.root_path || '—'); root.title = entry.root_path || '';
      const saved = el('span', '', formatDate(entry.saved_ms));
      const logical = el('span', 'numeric', formatSize(entry.logical_bytes));
      const allocated = el('span', 'numeric', formatSize(entry.allocated_bytes));
      const files = el('span', 'numeric', integer(entry.files));
      const actions = el('span', 'history-actions');
      const load = el('button', 'button compact', t('Load'));
      const compare = el('button', 'button compact', t('Compare'));
      const remove = el('button', 'button compact danger-text', t('Delete'));
      load.addEventListener('click', () => send({ cmd: 'history_load', scan_id: entry.id }).catch(reportError));
      compare.disabled = !state.rootNode;
      compare.addEventListener('click', () => {
        state.analyzing = true; setActiveView('compare'); $('comparePath').textContent = entry.root_path;
        send({ cmd: 'compare_history', scan_id: entry.id, limit: 2000 }).catch(reportError);
      });
      remove.addEventListener('click', async () => {
        if (await confirmDialog(t('Delete history entry?'), t('This deletes only DiskMosaic history data, never filesystem content.'))) {
          await send({ cmd: 'history_delete', scan_id: entry.id });
        }
      });
      actions.append(load, compare, remove);
      row.append(root, saved, logical, allocated, files, actions);
      frag.appendChild(row);
    }
    host.replaceChildren(frag);
  }

  async function saveHashResults(event) {
    const results = event.results || [];
    const errors = event.errors || [];
    if (!results.length && !errors.length) { toast(t('No files were hashed.')); return; }
    const content = JSON.stringify({ format: 'DiskMosaic selection hashes', version: 1, algorithm: 'BLAKE3', generated_at: new Date().toISOString(), results, errors }, null, 2);
    const saved = await api.saveTextFile({ suggestedName: `DiskMosaic-selection-hashes-${new Date().toISOString().replace(/[:.]/g, '-')}.json`, content });
    toast(saved ? t('Hash results saved.') : t('Hash calculation completed.'));
  }

  async function initializeStartup() {
    const startup = await api.getStartupPath();
    if (startup) {
      await startScan(startup);
      return;
    }
    await loadRoots();
  }

  async function loadRoots() {
    renderSavedLocations();
    if (!state.engineReady) return;
    const choices = $('rootChoices');
    choices.replaceChildren(el('div', 'loading', 'Detecting filesystems…'));
    try {
      const event = await makeRequest({ cmd: 'list_roots' }, 'roots');
      choices.replaceChildren();
      if (!event.roots?.length) {
        choices.appendChild(el('div', 'loading', 'No filesystem roots were detected. Use Select Folder.'));
        return;
      }
      for (const root of event.roots) {
        const button = el('button', 'root-choice');
        button.type = 'button';
        button.appendChild(el('strong', '', root.path));
        const used = Math.max(0, root.total_bytes - root.available_bytes);
        button.appendChild(el('span', '', `${formatSize(used)} used of ${formatSize(root.total_bytes)}`));
        button.addEventListener('click', () => startScan(root.path).catch(reportError));
        choices.appendChild(button);
      }
    } catch (error) {
      choices.replaceChildren(el('div', 'loading', error.message));
    }
  }

  async function chooseFolderAndScan() {
    const folder = await api.chooseFolder();
    if (folder) await startScan(folder);
  }

  async function startScan(path) {
    if (!path || state.scanning || state.analyzing) return;
    state.errorCount = 0;
    updateErrorBadge(0);
    $('exportButton').disabled = true;
    $('saveSnapshotButton').disabled = true;
    state.snapshotPath = null;
    $('progressPath').textContent = `Starting: ${path}`;
    $('progressFiles').textContent = '0';
    $('progressDirs').textContent = '0';
    $('progressBytes').textContent = formatSize(0);
    $('progressAllocated').textContent = formatSize(0);
    $('progressElapsed').textContent = '0:00';
    $('progressErrors').textContent = '0';
    $('progressExcluded').textContent = '0';
    $('treemapScanPath').textContent = path;
    $('treemapScanPath').title = path;
    $('treemapScanStats').textContent = `0 ${t('files')} · 0 B ${t('analyzed')}`;
    const options = {
      workers: Number(state.settings.workers) || 0,
      follow_symlinks: !!state.settings.followSymlinks,
      cross_filesystems: !!state.settings.crossFilesystems,
      deduplicate_hardlinks: !!state.settings.hardlinks,
      exclude_patterns: String(state.settings.excludePatterns || '').split(/\r?\n/).map(value => value.trim()).filter(Boolean),
    };
    await send({ cmd: 'scan', path, options });
  }

  function updateScanSummaryStrip() {
    const strip = $('scanSummaryStrip');
    if (!strip) return;
    if (!state.rootNode || !state.summary) { strip.classList.add('hidden'); return; }
    strip.classList.remove('hidden');
    const source = $('summarySource');
    const sourceChip = source?.closest('.summary-chip');
    if (source) {
      source.textContent = state.snapshotPath ? t('Saved scan') : t('Live scan');
      source.title = state.snapshotPath || state.rootPath || '';
    }
    sourceChip?.classList.toggle('saved', !!state.snapshotPath);
    $('summaryLogical').textContent = formatSize(state.summary.bytes || 0);
    $('summaryAllocated').textContent = formatSize(state.summary.allocated_bytes ?? state.summary.bytes ?? 0);
    $('summaryFiles').textContent = integer(state.summary.files || 0);
    $('summaryDirs').textContent = integer(state.summary.directories || 0);
    $('summaryFree').textContent = state.summary.filesystem_available_bytes == null ? '—' : formatSize(state.summary.filesystem_available_bytes);
    const selectionButton = $('selectionActionsButton');
    const selection = state.selectionSummary;
    if (selection?.selected_items > 0) {
      const count = Number(selection.selected_items || 0);
      const bytes = state.sizeBasis === 'allocated' ? Number(selection.allocated_size || 0) : Number(selection.logical_size || 0);
      $('summarySelected').textContent = count === 1 && state.selectedNode
        ? `${state.selectedNode.name || state.selectedNode.path} · ${formatSize(bytes)}`
        : `${integer(count)} ${t('items selected')} · ${formatSize(bytes)}`;
      $('summarySelected').title = `${integer(selection.files || 0)} ${t('files')} · ${integer(selection.directories || 0)} ${t('directories')} · ${formatSize(selection.logical_size || 0)} ${t('logical')} · ${formatSize(selection.allocated_size || 0)} ${t('allocated')}`;
      selectionButton.disabled = false;
    } else {
      $('summarySelected').textContent = t('Nothing selected');
      $('summarySelected').title = t('Click after selecting items for batch actions.');
      selectionButton.disabled = true;
    }
  }

  function updateProgress(event) {
    $('progressPath').textContent = `${event.paused ? t('Paused') : t('Scanning')}: ${event.current_path || ''}`;
    $('progressPath').title = event.current_path || '';
    $('progressFiles').textContent = integer(event.files);
    $('progressDirs').textContent = integer(event.directories);
    $('progressBytes').textContent = formatSize(event.bytes);
    $('progressAllocated').textContent = formatSize(event.allocated_bytes ?? event.bytes);
    $('progressElapsed').textContent = formatElapsed(event.elapsed_ms);
    $('progressErrors').textContent = integer(event.errors);
    $('progressExcluded').textContent = integer(event.excluded || 0);
    $('treemapScanPath').textContent = event.current_path || t('Scanning…');
    $('treemapScanPath').title = event.current_path || '';
    $('treemapScanStats').textContent = `${event.paused ? `${t('Paused')} · ` : ''}${integer(event.files)} ${t('files')} · ${formatSize(event.bytes)} ${t('logical')} · ${formatSize(event.allocated_bytes ?? event.bytes)} ${t('allocated')}${event.excluded ? ` · ${integer(event.excluded)} ${t('excluded')}` : ''} · ${formatElapsed(event.elapsed_ms)}`;
    updateErrorBadge(event.errors || 0, false);
  }

  async function finishScan(event) {
    state.scanning = false;
    state.scanPaused = false;
    $('pauseButton').disabled = true;
    state.rootNode = event.root;
    state.rootPath = event.root?.path || null;
    state.summary = event.summary || null;
    state.extensionStats = event.extension_stats || [];
    state.statistics = event.statistics || null;
    state.activeExtensions = [];
    state.activeCategories = [];
    state.duplicateResult = null;
    state.duplicateRows = [];
    state.comparisonResult = null;
    state.comparisonRows = [];
    state.selectedIds = new Set();
    state.selectionSummary = null;
    state.selectionTruncated = false;
    state.selectedNode = null;
    state.richMetadata = null;
    state.navBack = [];
    state.navForward = [];
    state.treemapMode = 'current';
    duplicateList.setRows([]);
    compareList.setRows([]);
    renderDuplicateSummary();
    renderComparisonSummary();
    state.errorCount = event.summary?.errors || 0;
    $('progressPanel').classList.add('hidden');
    $('treemapScanOverlay').classList.add('hidden');
    $('rescanButton').disabled = !state.rootPath;
    $('exportButton').disabled = !state.rootPath;
    $('saveSnapshotButton').disabled = !state.rootPath;
    $('historyStoreButton').disabled = !state.rootPath;
    renderBreadcrumbs(state.rootNode);
    $('statusText').textContent = state.errorCount ? t('Scan completed with {count} inaccessible entries', { count: integer(state.errorCount) }) : t('Scan completed');
    const volumeFree = event.summary?.filesystem_available_bytes;
    const allocated = Number(event.summary?.allocated_bytes ?? event.summary?.bytes ?? 0);
    const physicalNote = allocated !== Number(event.summary?.bytes || 0) ? ` · ${formatSize(allocated)} allocated` : '';
    $('statusSummary').textContent = `${integer(event.summary?.files || 0)} files · ${formatSize(event.summary?.bytes || 0)} logical${physicalNote}${event.summary?.excluded ? ` · ${integer(event.summary.excluded)} excluded` : ''}${volumeFree != null ? ` · ${formatSize(volumeFree)} volume free` : ''} · ${formatElapsed(event.summary?.elapsed_ms || 0)}`;
    updateErrorBadge(state.errorCount);
    updateScanSummaryStrip();
    rememberRecent(state.rootPath);
    updateBookmarkButton();
    $('startOverlay').classList.add('hidden');

    state.treeRows = [{ node: state.rootNode, depth: 0, expanded: false, type: 'node' }];
    treeList.setRows(state.treeRows);
    renderExtensions();
    renderStatistics();
    clearDetails();
    state.treemapHistory = [];
    $('backButton').disabled = true;
    await expandTreeRow(state.treeRows[0]);
    await focusTreemap(0, false);
    if (!event.saved_source && state.settings.watchFilesystem) startWatcher().catch(reportError);
    loadHistory().catch(() => {});
    const activeView = document.querySelector('.tab.active')?.dataset.view;
    if (activeView === 'largest') await loadLargest();
  }

  async function finishLoadedSnapshot(event) {
    await finishScan({
      ...event,
      event: 'scan_completed',
      scan_id: event.request_id || 'snapshot',
      saved_source: true,
    });
    state.snapshotPath = event.path || null;
    await send({ cmd: 'watch_stop' }).catch(() => {});
    setWatcherState('not_watching');
    updateScanSummaryStrip();
    $('statusText').textContent = t('Saved scan loaded');
    toast(`Loaded saved scan: ${event.path}`);
  }

  function updateErrorBadge(count, enable = true) {
    $('errorBadge').textContent = integer(count || 0);
    $('errorsButton').disabled = enable ? !(count > 0) : true;
  }

  function renderTreeRow(row, index) {
    if (row.type === 'load_more') {
      const line = el('div', 'virtual-row tree-row load-more');
      const name = el('div', 'tree-name');
      name.style.paddingLeft = `${10 + row.depth * 18}px`;
      name.textContent = `Load more… (${integer(row.remaining)} remaining)`;
      const extras = ['logical','allocated','share','files','directories','modified','owner','permissions'].map(key => { const cell=el('span'); cell.dataset.treeColumn=key; return cell; });
      name.dataset.treeColumn='name';
      line.append(name, ...extras);
      applyTreeColumnLayout();
      line.addEventListener('click', () => loadMoreChildren(row).catch(reportError));
      return line;
    }

    const node = row.node;
    const line = el('div', `virtual-row tree-row kind-${node.kind}${row.depth === 0 ? ' root-row' : ''}`);
    if (state.selectedNode?.id === node.id) line.classList.add('selected');
    if (state.selectedIds.has(node.id)) line.classList.add('multi-selected');
    line.dataset.nodeId = String(node.id);
    line.style.setProperty('--row-depth', String(row.depth));
    line.title = node.path;

    const name = el('div', 'tree-name');
    name.style.paddingLeft = `${6 + row.depth * 18}px`;
    const twisty = el('button', `twisty${node.kind === 'directory' ? '' : ' placeholder'}`, node.kind === 'directory' ? (row.expanded ? '▾' : '▸') : '');
    twisty.type = 'button';
    twisty.addEventListener('click', event => {
      event.stopPropagation();
      toggleTreeRow(row).catch(reportError);
    });
    const icon = makeFileIcon(node);
    const label = el('span', 'label', node.name || node.path);
    name.append(twisty, icon, label);

    const size = el('span', 'numeric size-value', formatSize(node.size));
    size.title = `${integer(node.size)} logical bytes`;
    const allocated = el('span', 'numeric allocated-value', formatSize(node.allocated_size ?? node.size));
    allocated.title = `${integer(node.allocated_size ?? node.size)} allocated bytes`;
    const basisBytes = basisSize(node);
    const rootBytes = rootBasisSize();
    const pct = rootBytes ? (basisBytes / rootBytes) * 100 : 0;
    if (row.depth > 0 && pct >= 10) line.classList.add('dominant-item');
    const pctCell = el('div', 'share-cell');
    const shareTrack = el('div', 'share-track');
    const shareFill = el('span', 'share-fill');
    shareFill.style.width = `${Math.max(0, Math.min(100, pct))}%`;
    if (state.settings.treeShareBandColorsEnabled) {
      shareFill.classList.add('banded');
      shareFill.style.setProperty('--share-band-color', treeShareBandColor(pct));
    }
    shareTrack.append(shareFill);
    const shareText = el('span', 'share-text', `${pct.toFixed(pct >= 10 ? 1 : 2)}%`);
    pctCell.append(shareTrack, shareText);
    pctCell.title = `${pct.toFixed(3)}% of the full scan by ${state.sizeBasis} size`;
    const files = el('span', 'numeric', integer(node.file_count || 0));
    const dirs = el('span', 'numeric', integer(node.dir_count || 0));
    const modified = el('span', '', formatDate(node.modified_ms));
    const owner = el('span', '', node.owner_hint || '—');
    const permissions = el('span', 'mono-small', node.permissions_hint || '—');
    const keyed = [[name,'name'],[size,'logical'],[allocated,'allocated'],[pctCell,'share'],[files,'files'],[dirs,'directories'],[modified,'modified'],[owner,'owner'],[permissions,'permissions']];
    for (const [cell,key] of keyed) { cell.dataset.treeColumn=key; cell.style.order=String(normalizeTreeColumnOrder(state.settings.treeColumnOrder).indexOf(key)); }
    line.append(...keyed.map(([cell]) => cell));

    line.addEventListener('click', event => selectTreeNode(node, index, event).catch(reportError));
    line.addEventListener('dblclick', () => {
      if (node.kind === 'directory') focusTreemap(node.id, true).catch(reportError);
      else api.openPath(node.path).catch(reportError);
    });
    line.addEventListener('contextmenu', event => showContextMenu(event, node));
    return line;
  }

  async function toggleTreeRow(row) {
    if (row.node.kind !== 'directory') return;
    if (row.expanded) collapseTreeRow(row);
    else await expandTreeRow(row);
  }

  function collapseTreeRow(row) {
    const index = state.treeRows.indexOf(row);
    if (index < 0) return;
    let end = index + 1;
    while (end < state.treeRows.length && state.treeRows[end].depth > row.depth) end += 1;
    state.treeRows.splice(index + 1, end - index - 1);
    row.expanded = false;
    treeList.setRows(state.treeRows);
  }

  async function expandTreeRow(row) {
    if (!row || row.node.kind !== 'directory' || row.expanded) return;
    const response = await makeRequest({
      cmd: 'children', parent_id: row.node.id, offset: 0, limit: 5000,
      sort: state.treeSort.field, descending: state.treeSort.descending, hidden_mode: hiddenDisplayMode(),
    }, 'children');
    const index = state.treeRows.indexOf(row);
    if (index < 0) return;
    const children = (response.items || []).map(node => ({ node, depth: row.depth + 1, expanded: false, type: 'node' }));
    if (response.total > children.length) {
      children.push({
        type: 'load_more', parentId: row.node.id, offset: children.length,
        depth: row.depth + 1, remaining: response.total - children.length,
      });
    }
    state.treeRows.splice(index + 1, 0, ...children);
    row.expanded = true;
    treeList.setRows(state.treeRows);
  }

  async function loadMoreChildren(row) {
    const response = await makeRequest({
      cmd: 'children', parent_id: row.parentId, offset: row.offset, limit: 5000,
      sort: state.treeSort.field, descending: state.treeSort.descending, hidden_mode: hiddenDisplayMode(),
    }, 'children');
    const index = state.treeRows.indexOf(row);
    if (index < 0) return;
    const rawItems = response.items || [];
    // Ancestor-path reveal may inject one direct child that was outside the first
    // 5,000-row page. Suppress it when a later normal page reaches that node.
    const visibleIds = new Set(state.treeRows.filter(candidate => candidate.type === 'node').map(candidate => candidate.node.id));
    const items = rawItems
      .filter(node => !visibleIds.has(node.id))
      .map(node => ({ node, depth: row.depth, expanded: false, type: 'node' }));
    const newOffset = row.offset + rawItems.length;
    if (newOffset < response.total) {
      items.push({ ...row, offset: newOffset, remaining: response.total - newOffset });
    }
    state.treeRows.splice(index, 1, ...items);
    treeList.setRows(state.treeRows);
  }

  function injectAncestorPathChild(parentRow, childNode) {
    const existing = state.treeRows.find(candidate => candidate.type === 'node' && candidate.node.id === childNode.id);
    if (existing) return existing;
    const parentIndex = state.treeRows.indexOf(parentRow);
    if (parentIndex < 0) return null;
    const injected = {
      node: childNode,
      depth: parentRow.depth + 1,
      expanded: false,
      type: 'node',
      pathInjected: true,
    };
    // Put the path child directly below its parent. This keeps reveal O(depth)
    // and avoids loading every sibling merely to expose a selected deep node.
    state.treeRows.splice(parentIndex + 1, 0, injected);
    treeList.setRows(state.treeRows);
    return injected;
  }

  async function reloadTree() {
    if (!state.rootNode) return;
    state.treeRows = [{ node: state.rootNode, depth: 0, expanded: false, type: 'node' }];
    treeList.setRows(state.treeRows);
    await expandTreeRow(state.treeRows[0]);
  }

  function selectNode(node, syncSelection = true) {
    state.selectedNode = node;
    state.richMetadata = null;
    updateDetails(node);
    if (syncSelection) {
      if (node) send({ cmd: 'selection_replace', node_ids: [node.id] }).catch(reportError);
      else send({ cmd: 'selection_clear' }).catch(() => {});
    }
    updateScanSummaryStrip();
    treeList.refresh();
    largestList.refresh();
    searchList.refresh();
    updateTreemapControls();
    drawTreemap();
    if (node) {
      const index = state.treeRows.findIndex(row => row.type === 'node' && row.node.id === node.id);
      if (index >= 0) treeList.scrollToIndex(index);
      loadRichMetadata(node).catch(() => {});
    }
  }

  async function selectTreeNode(node, index, event) {
    const ctrl = !!(event.ctrlKey || event.metaKey);
    if (event.shiftKey && state.selectionAnchorIndex != null) {
      const [start, end] = [state.selectionAnchorIndex, index].sort((a, b) => a - b);
      const ids = state.treeRows.slice(start, end + 1).filter(row => row.type === 'node').slice(0, 10000).map(row => row.node.id);
      await send({ cmd: 'selection_replace', node_ids: ids });
    } else if (ctrl) {
      await send({ cmd: 'selection_toggle', node_id: node.id });
      state.selectionAnchorIndex = index;
    } else {
      await send({ cmd: 'selection_replace', node_ids: [node.id] });
      state.selectionAnchorIndex = index;
    }
    selectNode(node, false);
  }

  async function revealNodeInTree(node, syncSelection = true) {
    if (!node || !state.rootNode) return;
    const event = await makeRequest({ cmd: 'ancestors', node_id: node.id }, 'ancestors');
    const ancestors = event.items || [];
    if (!ancestors.length) { selectNode(node, syncSelection); return; }
    for (let i = 0; i < ancestors.length - 1; i += 1) {
      const ancestor = ancestors[i];
      const child = ancestors[i + 1];
      let row = state.treeRows.find(candidate => candidate.type === 'node' && candidate.node.id === ancestor.id);
      if (!row && ancestor.id === 0) {
        await reloadTree();
        row = state.treeRows[0];
      }
      if (row && row.node.kind === 'directory' && !row.expanded) await expandTreeRow(row);
      if (row && !state.treeRows.some(candidate => candidate.type === 'node' && candidate.node.id === child.id)) {
        injectAncestorPathChild(row, child);
      }
    }
    selectNode(node, syncSelection);
  }

  async function updateSelectionInspector() {
    const summary = state.selectionSummary;
    if (!summary || Number(summary.selected_items || 0) <= 1) {
      if (!state.selectedNode && !summary?.selected_items) updateDetails(null);
      return;
    }
    const token = ++state.selectionInspectorToken;
    state.metadataToken += 1;
    $('detailName').textContent = `${integer(summary.selected_items)} ${t('items selected')}`;
    $('detailName').title = '';
    $('detailCategory').textContent = summary.effective_items < summary.selected_items
      ? `${integer(summary.effective_items)} effective top-level selections; nested descendants are counted once.`
      : 'Multi-selection summary';
    $('detailGlyph').textContent = '✓';
    const rootBytes = rootBasisSize();
    const selectedBytes = state.sizeBasis === 'allocated' ? Number(summary.allocated_size || 0) : Number(summary.logical_size || 0);
    const share = rootBytes ? selectedBytes / rootBytes * 100 : 0;
    $('detailShareBar').style.width = `${Math.min(100, Math.max(0, share))}%`;
    $('detailPath').textContent = 'Multiple paths';
    $('detailSize').textContent = `${formatSize(summary.logical_size || 0)} (${integer(summary.logical_size || 0)} bytes)`;
    $('detailAllocated').textContent = `${formatSize(summary.allocated_size || 0)} (${integer(summary.allocated_size || 0)} bytes)`;
    $('detailLinks').textContent = '—';
    $('detailShare').textContent = `${share.toFixed(share >= 10 ? 1 : 2)}% (${state.sizeBasis})`;
    $('detailParentShare').textContent = '—';
    $('detailType').textContent = `${integer(summary.files || 0)} ${t('files')} · ${integer(summary.directories || 0)} ${t('directories')}`;
    $('detailExtension').textContent = '—'; $('detailModified').textContent = '—';
    $('detailChildren').textContent = `${integer(summary.files || 0)} ${t('files')} · ${integer(summary.directories || 0)} ${t('directories')}`;
    for (const id of ['detailCreated','detailAccessed','detailIdentity','detailPermissions','detailOwner','detailSymlinkTarget','detailAllocationFlags','detailDevice']) $(id).textContent='—';
    try {
      const items = await fetchSelectionItems(2000);
      if (token !== state.selectionInspectorToken || Number(state.selectionSummary?.selected_items || 0) <= 1) return;
      const categories = new Map();
      for (const item of items) if (item.kind === 'file') {
        const name = categoryForNode(item).name;
        categories.set(name, (categories.get(name) || 0) + 1);
      }
      const top = [...categories].sort((a,b)=>b[1]-a[1]).slice(0,4).map(([name,count])=>`${name} ${integer(count)}`).join(' · ');
      if (top) $('detailCategory').textContent = `${top}${Number(summary.selected_items) > items.length ? ` · sample ${integer(items.length)}/${integer(summary.selected_items)}` : ''}`;
    } catch (_) { /* summary remains useful even if the bounded breakdown cannot be loaded */ }
  }

  function updateDetails(node) {
    const rootBytes = rootBasisSize();
    const share = node && rootBytes ? (basisSize(node) / rootBytes) * 100 : null;
    const category = node?.kind === 'file' ? categoryForNode(node) : null;
    $('detailName').textContent = node?.name || t('Nothing selected');
    $('detailName').title = node?.path || '';
    $('detailCategory').textContent = node
      ? (node.kind === 'file' ? `${t(category.name)} · ${recognizedExtension(node) || detectedTypeLabel(node)}` : `${t(node.kind)} · ${formatSize(basisSize(node))} ${t(state.sizeBasis)}`)
      : t('Select a file or directory in any synchronized view.');
    $('detailGlyph').textContent = !node ? '◇' : node.kind === 'directory' ? '▰' : node.kind === 'symlink' ? '↗' : '▤';
    $('detailShareBar').style.width = `${Math.max(0, Math.min(100, share || 0))}%`;
    $('detailPath').textContent = node?.path || '—';
    $('detailSize').textContent = node ? `${formatSize(node.size)} (${integer(node.size)} bytes)` : '—';
    $('detailAllocated').textContent = node ? `${formatSize(node.allocated_size ?? node.size)} (${integer(node.allocated_size ?? node.size)} bytes)` : '—';
    $('detailLinks').textContent = node ? integer(node.link_count || 1) : '—';
    $('detailShare').textContent = share == null ? '—' : `${share.toFixed(share >= 10 ? 1 : 2)}% (${state.sizeBasis})`;
    const parent = node?.parent != null ? state.treeRows.find(row => row.type === 'node' && row.node.id === node.parent)?.node : null;
    const parentBytes = parent ? basisSize(parent) : rootBytes;
    const parentShare = node && parentBytes ? basisSize(node) / parentBytes * 100 : null;
    $('detailParentShare').textContent = parentShare == null ? '—' : `${parentShare.toFixed(parentShare >= 10 ? 1 : 2)}%`;
    $('detailAllocationFlags').textContent = node ? [node.sparse === true ? 'sparse' : '', node.compressed === true ? 'compressed' : ''].filter(Boolean).join(' · ') || 'none reported' : '—';
    $('detailDevice').textContent = node?.identity_volume != null ? String(node.identity_volume) : '—';
    $('detailType').textContent = node ? (node.kind === 'file' ? `${t('file')} · ${t(category.name)} · ${detectedTypeLabel(node)}` : t(node.kind)) : '—';
    $('detailExtension').textContent = recognizedExtension(node) || (node?.type_hint ? `(none · ${detectedTypeLabel(node)})` : (node ? '(none)' : '—'));
    $('detailModified').textContent = node ? formatDate(node.modified_ms) : '—';
    $('detailChildren').textContent = node?.kind === 'directory' ? `${integer(node.file_count || 0)} ${t('files')} · ${integer(node.dir_count || 0)} ${t('directories')}` : '—';
    for (const id of ['detailCreated','detailAccessed','detailIdentity','detailPermissions','detailOwner','detailSymlinkTarget']) if ($(id)) $(id).textContent = '—';
  }

  async function loadRichMetadata(node) {
    if (!node) return;
    const token = ++state.metadataToken;
    $('detailsPanel')?.classList.add('metadata-pending');
    try {
      const event = await makeRequest({ cmd: 'get_metadata', node_id: node.id }, 'metadata', 10000);
      if (token !== state.metadataToken || state.selectedNode?.id !== node.id) return;
      const m = event.metadata;
      state.richMetadata = m || null;
      $('detailCreated').textContent = formatDate(m?.created_ms);
      $('detailAccessed').textContent = formatDate(m?.accessed_ms);
      $('detailSymlinkTarget').textContent = m?.symlink_target || '—';
      const identity = m?.identity_volume != null || m?.identity_index != null
        ? `${m.identity_volume ?? '—'}:${m.identity_index ?? '—'}` : '—';
      $('detailIdentity').textContent = identity;
      $('detailDevice').textContent = m?.identity_volume != null ? String(m.identity_volume) : ($('detailDevice').textContent || '—');
      if (m?.unix) {
        $('detailPermissions').textContent = `${m.unix.permissions} · mode 0${Number(m.unix.mode || 0).toString(8)}`;
        $('detailOwner').textContent = `UID ${m.unix.uid} · GID ${m.unix.gid}`;
      } else if (m?.windows) {
        const flags = [m.windows.compressed && 'compressed', m.windows.sparse && 'sparse', m.windows.reparse_point && 'reparse'].filter(Boolean);
        $('detailPermissions').textContent = `attributes 0x${Number(m.windows.attributes || 0).toString(16)}${flags.length ? ` · ${flags.join(', ')}` : ''}`;
        $('detailAllocationFlags').textContent = flags.filter(value => value === 'sparse' || value === 'compressed').join(' · ') || 'none reported';
        $('detailOwner').textContent = '—';
      } else {
        $('detailPermissions').textContent = '—'; $('detailOwner').textContent = '—';
      }
      if (m?.optional_error) $('detailIdentity').title = m.optional_error;
    } finally {
      if (token === state.metadataToken) $('detailsPanel')?.classList.remove('metadata-pending');
    }
  }

  function clearDetails() { selectNode(null); }

  function containingDirectory(pathValue) {
    const value = String(pathValue || '');
    const stripped = value.replace(/[\\/]+$/, '');
    const index = Math.max(stripped.lastIndexOf('/'), stripped.lastIndexOf('\\'));
    if (index < 0) return '';
    if (index === 2 && /^[A-Za-z]:/.test(stripped)) return stripped.slice(0, 3);
    return index === 0 ? stripped.slice(0, 1) : stripped.slice(0, index);
  }

  function renderResultRow(node, className) {
    const line = el('div', `virtual-row ${className}`);
    if (state.selectedNode?.id === node.id) line.classList.add('selected');
    if (state.selectedIds.has(node.id)) line.classList.add('multi-selected');
    const name = el('span', 'result-name');
    name.append(makeFileIcon(node), el('span', 'label', node.name));
    const pathCell = el('span', '', node.path);
    pathCell.title = node.path;
    const size = el('span', 'numeric', formatSize(basisSize(node)));
    size.title = `Logical: ${formatSize(node.size)} · Allocated: ${formatSize(node.allocated_size ?? node.size)}`;
    const type = el('span', '', detectedTypeLabel(node));
    line.append(name, pathCell, size, type);
    if (className === 'largest-row') {
      const directory = containingDirectory(node.path);
      const directoryCell = el('span', '', directory);
      directoryCell.title = directory;
      line.appendChild(directoryCell);
    }
    line.addEventListener('click', event => {
      const cmd = event.ctrlKey || event.metaKey ? { cmd: 'selection_toggle', node_id: node.id } : { cmd: 'selection_replace', node_ids: [node.id] };
      send(cmd).catch(reportError);
      selectNode(node, false);
    });
    line.addEventListener('dblclick', () => node.kind === 'directory' ? focusTreemap(node.id, true).catch(reportError) : api.openPath(node.path).catch(reportError));
    line.addEventListener('contextmenu', event => showContextMenu(event, node));
    return line;
  }

  function buildDuplicateRows() {
    const rows = [];
    for (const [index, group] of (state.duplicateResult?.groups || []).entries()) {
      rows.push({ type: 'group', group, index });
      for (const item of group.items || []) rows.push({ type: 'file', group, item, index });
    }
    state.duplicateRows = rows;
    duplicateList.setRows(rows);
  }

  function renderDuplicateRow(row) {
    const line = el('div', `virtual-row duplicate-row ${row.type}`);
    if (row.type === 'file' && state.selectedIds.has(row.item?.id)) line.classList.add('proposed');
    if (row.type === 'group') {
      const group = row.group;
      const name = el('span', 'duplicate-group-name', `Duplicate group ${row.index + 1}`);
      name.title = group.items?.[0]?.path || '';
      line.append(
        name,
        el('span', 'numeric', integer(group.files || 0)),
        el('span', 'numeric', formatSize(group.size || 0)),
        el('span', 'numeric recoverable', formatSize(state.sizeBasis === 'allocated' ? group.recoverable_allocated : group.recoverable_logical)),
        el('span', 'numeric', formatSize(group.allocated_size || group.recoverable_allocated || 0)),
      );
      return line;
    }
    const item = row.item;
    const pathCell = el('span', 'duplicate-file-path');
    pathCell.append(el('strong','',`↳ ${item.path}`),el('small','',`${item.directory||containingDirectory(item.path)} · ${formatDate(item.modified_ms)} · device ${item.device??'unknown'} · ${integer(item.hard_link_count??1)} hard link(s)`));
    pathCell.title = item.path;
    line.append(
      pathCell,
      el('span', 'numeric muted', '—'),
      el('span', 'numeric', formatSize(item.size || 0)),
      el('span', 'numeric muted', '—'),
      el('span', 'numeric', formatSize(item.allocated_size ?? item.size ?? 0)),
    );
    line.title = `${item.path} · ${formatDate(item.modified_ms)} · device ${item.device ?? 'unknown'} · hard links ${item.hard_link_count ?? 1}`;
    line.addEventListener('click', async () => {
      const event = await makeRequest({ cmd: 'get_node', node_id: item.id }, 'node');
      if (event.node) await revealNodeInTree(event.node);
    });
    line.addEventListener('dblclick', () => api.openPath(item.path).catch(reportError));
    line.addEventListener('contextmenu', async event => {
      event.preventDefault();
      const response = await makeRequest({ cmd: 'get_node', node_id: item.id }, 'node');
      if (response.node) showContextMenu(event, response.node);
    });
    return line;
  }

  function renderDuplicateSummary() {
    const host = $('duplicateSummary');
    if (!host) return;
    host.replaceChildren();
    const result = state.duplicateResult;
    if (!result) {
      host.appendChild(el('span', 'muted', 'Duplicate analysis is opt-in and never runs during an ordinary scan.'));
      return;
    }
    const metrics = [
      [integer(result.groups?.length || 0), 'verified groups'],
      [integer(result.candidate_files || 0), 'candidate files'],
      [formatSize(result.recoverable_logical || 0), 'recoverable logical'],
      [formatSize(result.recoverable_allocated || 0), 'recoverable allocated'],
      [integer(result.errors || 0), 'read errors'],
    ];
    for (const [value, label] of metrics) {
      const card = el('div', 'mini-metric');
      card.append(el('strong', '', value), el('span', '', label));
      host.appendChild(card);
    }
    if (result.groups?.length) {
      const helpers = el('div', 'analysis-helper-actions');
      for (const [label, strategy] of [[t('Keep newest'), 'newest'], [t('Keep oldest'), 'oldest'], [t('Keep shortest path'), 'shortest'], [t('Keep selected path'), 'selected']]) {
        const button = el('button', 'button compact', label); button.type = 'button';
        button.title = t('Selects the other copies only; does not delete anything.');
        button.addEventListener('click', () => proposeDuplicateSelection(strategy));
        helpers.appendChild(button);
      }
      const clear=el('button','button compact',t('Clear proposal'));clear.type='button';clear.addEventListener('click',()=>send({cmd:'selection_clear'}).catch(reportError));helpers.appendChild(clear);
      const review=el('button','button compact',t('Review proposed Trash…'));review.type='button';review.title=t('Opens the normal confirmed Trash workflow for the current proposal; nothing is deleted automatically.');review.addEventListener('click',()=>selectionAction('trash').catch(reportError));helpers.appendChild(review);
      host.appendChild(helpers);
    }
  }

  async function startDuplicateAnalysis() {
    if (!state.rootNode || state.scanning || state.analyzing) return;
    const raw = $('duplicateMinSize').value.trim() || String(state.settings.duplicateMinSize || '1 MiB');
    const minSize = parseSize(raw);
    if (minSize == null) { toast(t('Invalid duplicate minimum size.'), true); return; }
    state.settings.duplicateMinSize = raw;
    localStorage.setItem('diskmosaic.settings', JSON.stringify(state.settings));
    state.duplicateResult = null;
    state.duplicateRows = [];
    duplicateList.setRows([]);
    renderDuplicateSummary();
    $('duplicateProgress').textContent = t('Preparing duplicate candidates…');
    await send({ cmd: 'duplicate_scan', min_size: minSize, max_groups: 1000 });
  }

  function comparisonValue(change, which) {
    if (state.sizeBasis === 'allocated') return Number(change[`${which}_allocated`] || 0);
    return Number(change[`${which}_size`] || 0);
  }

  function renderComparisonRow(change) {
    const line = el('div', `virtual-row compare-row status-${change.status || 'changed'}`);
    const pathCell = el('span', '', change.relative_path || change.name || '—');
    pathCell.title = change.relative_path || '';
    const before = comparisonValue(change, 'before');
    const after = comparisonValue(change, 'after');
    const delta = after - before;
    const status = el('span', `change-status ${change.status || ''}`, change.status || 'changed');
    const deltaCell = el('span', `numeric delta ${delta > 0 ? 'positive' : delta < 0 ? 'negative' : ''}`,
      `${delta > 0 ? '+' : delta < 0 ? '−' : ''}${formatSize(Math.abs(delta))}`);
    line.append(pathCell, status, el('span', 'numeric', formatSize(before)), el('span', 'numeric', formatSize(after)), deltaCell);
    if (change.current_id != null) {
      line.classList.add('actionable-row');
      line.title = `${change.relative_path || change.name} · click to reveal current item`;
      line.addEventListener('click', async () => {
        const event = await makeRequest({ cmd: 'get_node', node_id: change.current_id }, 'node');
        if (event.node) await revealNodeInTree(event.node);
      });
    } else {
      line.title = `${change.relative_path || change.name} · deleted since saved scan`;
    }
    return line;
  }

  function renderComparisonSummary() {
    const host = $('compareSummary');
    if (!host) return;
    host.replaceChildren();
    const result = state.comparisonResult;
    if (!result) {
      host.appendChild(el('span', 'muted', 'Compare the current scan with a saved .dmscan snapshot to find growth, shrinkage, additions and deletions.'));
      return;
    }
    const before = state.sizeBasis === 'allocated' ? Number(result.before_allocated || 0) : Number(result.before_logical || 0);
    const after = state.sizeBasis === 'allocated' ? Number(result.after_allocated || 0) : Number(result.after_logical || 0);
    const delta = after - before;
    const metrics = [
      [`${delta >= 0 ? '+' : '−'}${formatSize(Math.abs(delta))}`, `${state.sizeBasis} change`],
      [integer(result.grown || 0), 'grown'], [integer(result.shrunk || 0), 'shrunk'],
      [integer(result.created || 0), 'created'], [integer(result.deleted || 0), 'deleted'],
      [integer(result.changed || 0), 'type changed'],
      [integer(result.files_added || 0), 'files added'], [integer(result.files_removed || 0), 'files removed'],
      [integer(result.files_changed || 0), 'files changed'], [integer(result.allocation_only || 0), 'allocation-only'],
    ];
    for (const [value, label] of metrics) {
      const card = el('div', 'mini-metric');
      card.append(el('strong', '', value), el('span', '', label));
      host.appendChild(card);
    }
    if (!result.compatible_root) {
      const warning = el('div', 'analysis-warning', 'The saved scan root differs from the current root; path matching may not be meaningful.');
      host.appendChild(warning);
    }
  }

  function snapshotSuggestedName() {
    const leaf = (String(state.rootPath || 'scan').split(/[\\/]/).filter(Boolean).pop() || 'scan').replace(/[^A-Za-z0-9._-]+/g, '-');
    return `DiskMosaic-${leaf}-${new Date().toISOString().slice(0, 10)}.dmscan`;
  }

  async function saveSnapshot() {
    if (!state.rootNode || state.scanning || state.analyzing) return;
    const path = await api.saveSnapshotPath(snapshotSuggestedName());
    if (!path) return;
    state.analyzing = true;
    $('statusText').textContent = t('Saving scan snapshot…');
    await send({ cmd: 'save_snapshot', path });
  }

  async function openSnapshot() {
    if (state.scanning || state.analyzing) return;
    const path = await api.openSnapshotPath();
    if (!path) return;
    state.analyzing = true;
    $('statusText').textContent = t('Loading saved scan…');
    $('startOverlay').classList.add('hidden');
    await send({ cmd: 'load_snapshot', path });
  }

  async function compareWithSnapshot() {
    if (!state.rootNode || state.scanning || state.analyzing) return;
    const path = await api.openSnapshotPath();
    if (!path) return;
    state.analyzing = true;
    $('comparePath').textContent = t('Comparing…');
    $('comparePath').title = path;
    await send({ cmd: 'compare_snapshot', path, limit: 2000 });
  }

  function sortLargestRows() {
    const { field, descending } = state.largestSort;
    const rows = [...state.largestRows];
    rows.sort((a, b) => {
      let cmp = 0;
      if (field === 'size') cmp = basisSize(a) - basisSize(b);
      else if (field === 'directory') cmp = containingDirectory(a.path).localeCompare(containingDirectory(b.path));
      else cmp = String(a[field] || '').localeCompare(String(b[field] || ''));
      if (cmp === 0) cmp = String(a.path || '').localeCompare(String(b.path || ''));
      return descending ? -cmp : cmp;
    });
    largestList.setRows(rows);
  }

  async function loadLargest() {
    if (!state.rootNode) return;
    const limit = Number($('largestLimit').value) || 100;
    const event = await makeRequest({ cmd: 'largest', limit, size_basis: state.sizeBasis, hidden_mode: hiddenDisplayMode() }, 'largest');
    state.largestRows = event.items || [];
    sortLargestRows();
  }

  function boolField(id) {
    const value = $(id)?.value || '';
    return value === '' ? undefined : value === 'true';
  }

  function splitOr(value) {
    return String(value || '').split(',').map(item => item.trim()).filter(Boolean).slice(0, 64);
  }

  function dateStart(id) { const value=$(id)?.value; return value ? new Date(`${value}T00:00:00`).getTime() : undefined; }
  function dateEnd(id) { const value=$(id)?.value; return value ? new Date(`${value}T23:59:59.999`).getTime() : undefined; }

  function buildAdvancedFilterQuery() {
    const minLogical = parseSize($('searchMinSize').value);
    const maxLogical = parseSize($('searchMaxSize').value);
    const minAllocated = parseSize($('searchMinAllocated')?.value || '');
    const maxAllocated = parseSize($('searchMaxAllocated')?.value || '');
    for (const [id, value] of [['searchMinSize',minLogical],['searchMaxSize',maxLogical],['searchMinAllocated',minAllocated],['searchMaxAllocated',maxAllocated]]) {
      if ($(id)?.value.trim() && value == null) throw new Error(t('Size is not valid. Examples: 500 MiB, 1.5 GiB.'));
    }
    if (minLogical != null && maxLogical != null && minLogical > maxLogical) throw new Error(t('Minimum logical size cannot be greater than maximum logical size.'));
    if (minAllocated != null && maxAllocated != null && minAllocated > maxAllocated) throw new Error(t('Minimum allocated size cannot be greater than maximum allocated size.'));
    const all = {
      filename_contains: $('searchName').value.trim(),
      path_contains: $('searchPath').value.trim(),
      extensions_any: splitOr($('searchExtension').value),
      categories_any: splitOr($('searchCategory')?.value),
      type_hints_any: splitOr($('searchTypeHint')?.value),
      kind: $('searchKind').value || undefined,
      min_logical: minLogical ?? undefined,
      max_logical: maxLogical ?? undefined,
      min_allocated: minAllocated ?? undefined,
      max_allocated: maxAllocated ?? undefined,
      modified_after_ms: dateStart('searchModifiedAfter'),
      modified_before_ms: dateEnd('searchModifiedBefore'),
      modified_unknown: $('searchModifiedState')?.value === 'unknown' ? true : $('searchModifiedState')?.value === 'known' ? false : undefined,
      created_after_ms: dateStart('searchCreatedAfter'),
      created_before_ms: dateEnd('searchCreatedBefore'),
      min_age_days: $('searchMinAge')?.value ? Number($('searchMinAge').value) : undefined,
      max_age_days: $('searchMaxAge')?.value ? Number($('searchMaxAge').value) : undefined,
      sparse: boolField('searchSparse'),
      compressed: boolField('searchCompressed'),
      min_hard_links: $('searchMinLinks')?.value ? Number($('searchMinLinks').value) : undefined,
      duplicate: boolField('searchDuplicate'),
      owner_contains: $('searchOwner')?.value.trim() || '',
      permissions_contains: $('searchPermissions')?.value.trim() || '',
      device: $('searchDevice')?.value ? Number($('searchDevice').value) : undefined,
    };
    return { all, any: [], offset: 0, limit: 1000, sort: state.sizeBasis === 'allocated' ? 'allocated' : 'logical', descending: true };
  }

  function clearAdvancedFilter() {
    for (const id of ['searchName','searchPath','searchExtension','searchMinSize','searchMaxSize','searchModifiedAfter','searchModifiedBefore','searchCategory','searchTypeHint','searchMinAllocated','searchMaxAllocated','searchCreatedAfter','searchCreatedBefore','searchMinAge','searchMaxAge','searchOwner','searchPermissions','searchDevice']) if ($(id)) $(id).value='';
    for (const id of ['searchKind','searchSparse','searchCompressed','searchDuplicate','searchModifiedState']) if ($(id)) $(id).value='';
    searchList.setRows([]); if ($('advancedFilterSummary')) $('advancedFilterSummary').textContent='';
  }

  async function runSearch(queryOverride = null) {
    if (!state.rootNode) return;
    let query;
    try { query = structuredClone(queryOverride || buildAdvancedFilterQuery()); } catch (error) { toast(error.message, true); return; }
    query.hidden_mode = hiddenDisplayMode();
    const event = await makeRequest({ cmd: 'advanced_filter', query }, 'advanced_filter_results', 60000);
    searchList.setRows(event.result?.items || []);
    if ($('advancedFilterSummary')) $('advancedFilterSummary').textContent = `${integer(event.result?.total || 0)} matching item(s) · showing ${integer(event.result?.items?.length || 0)} · heavy filtering executed in the Rust engine`;
    $('statusText').textContent = `Filters: ${integer(event.result?.total || 0)} result(s)`;
    persistWorkspaceState();
  }

  function loadSmartCollections() {
    try {
      const raw=JSON.parse(localStorage.getItem('diskmosaic.smartCollections')||'[]');
      state.smartCollections=Array.isArray(raw)?raw.filter(item=>item&&typeof item.name==='string'&&item.query&&typeof item.query==='object').slice(0,200):[];
    } catch (_) { state.smartCollections=[]; }
    renderSmartCollections();
  }
  function persistSmartCollections(){localStorage.setItem('diskmosaic.smartCollections',JSON.stringify(state.smartCollections.slice(0,200)));renderSmartCollections();}
  function renderSmartCollections(){
    const select=$('smartCollectionSelect'); if(select){const selected=select.value;select.replaceChildren(new Option(t('Choose saved collection…'),''));for(const item of state.smartCollections)select.appendChild(new Option(item.name,item.id));if(state.smartCollections.some(x=>x.id===selected))select.value=selected;}
    const home=$('homeSmartCollections'); if(home){home.replaceChildren();if(!state.smartCollections.length)home.appendChild(el('span','muted',t('No Smart Collections yet.')));for(const item of state.smartCollections.slice(0,8)){const b=el('button','saved-choice',item.name);b.type='button';b.addEventListener('click',()=>{ $('startOverlay').classList.add('hidden');setActiveView('search');runSearch(item.query).catch(reportError);});home.appendChild(b);}}
  }
  function selectedSmart(){const id=$('smartCollectionSelect')?.value;return state.smartCollections.find(item=>item.id===id)||null;}
  async function saveSmartCollection(){let query;try{query=buildAdvancedFilterQuery();}catch(error){toast(error.message,true);return;}const name=await askCollectionName(t('Smart Collection name'));if(!name)return;state.smartCollections.push({id:crypto.randomUUID(),name,query});persistSmartCollections();$('smartCollectionSelect').value=state.smartCollections.at(-1).id;toast(t('Smart Collection saved.'));}
  function updateSmartCollection(){const item=selectedSmart();if(!item){toast(t('Choose a Smart Collection first.'),true);return;}try{item.query=buildAdvancedFilterQuery();persistSmartCollections();toast(t('Smart Collection updated.'));}catch(error){toast(error.message,true);}}
  async function renameSmartCollection(){const item=selectedSmart();if(!item)return;const name=await askCollectionName(t('Rename Smart Collection'),item.name);if(name){item.name=name;persistSmartCollections();}}
  function duplicateSmartCollection(){const item=selectedSmart();if(!item)return;state.smartCollections.push({id:crypto.randomUUID(),name:`${item.name} ${t('copy')}`,query:structuredClone(item.query)});persistSmartCollections();}
  function deleteSmartCollection(){const item=selectedSmart();if(!item)return;if(!window.confirm(t('Delete this Smart Collection? This never changes filesystem content.')))return;state.smartCollections=state.smartCollections.filter(x=>x.id!==item.id);persistSmartCollections();}
  function openSmartCollection(){const item=selectedSmart();if(!item)return;applyFilterToForm(item.query);runSearch(item.query).catch(reportError);}
  function filterDateValue(ms) {
    if (!Number.isFinite(Number(ms))) return '';
    const date = new Date(Number(ms));
    if (Number.isNaN(date.getTime())) return '';
    return date.toISOString().slice(0, 10);
  }
  function applyFilterToForm(query){clearAdvancedFilter();const a=query?.all||{};$('searchName').value=a.filename_contains||'';$('searchPath').value=a.path_contains||'';$('searchExtension').value=(a.extensions_any||[]).join(', ');$('searchCategory').value=(a.categories_any||[]).join(', ');$('searchTypeHint').value=(a.type_hints_any||[]).join(', ');$('searchKind').value=a.kind||'';$('searchMinSize').value=a.min_logical?String(a.min_logical)+' B':'';$('searchMaxSize').value=a.max_logical?String(a.max_logical)+' B':'';$('searchMinAllocated').value=a.min_allocated?String(a.min_allocated)+' B':'';$('searchMaxAllocated').value=a.max_allocated?String(a.max_allocated)+' B':'';$('searchModifiedAfter').value=filterDateValue(a.modified_after_ms);$('searchModifiedBefore').value=filterDateValue(a.modified_before_ms);$('searchCreatedAfter').value=filterDateValue(a.created_after_ms);$('searchCreatedBefore').value=filterDateValue(a.created_before_ms);$('searchMinAge').value=a.min_age_days??'';$('searchMaxAge').value=a.max_age_days??'';$('searchSparse').value=a.sparse==null?'':String(a.sparse);$('searchCompressed').value=a.compressed==null?'':String(a.compressed);$('searchDuplicate').value=a.duplicate==null?'':String(a.duplicate);$('searchModifiedState').value=a.modified_unknown===true?'unknown':a.modified_unknown===false?'known':'';$('searchOwner').value=a.owner_contains||'';$('searchPermissions').value=a.permissions_contains||'';$('searchDevice').value=a.device??'';}


  async function loadHistoryExplorer() {
    if (!state.engineReady) return;
    const rootsEvent = await makeRequest({ cmd: 'history_roots' }, 'history_roots', 30000);
    const select = $('historyRootSelect');
    const selected = select.value || state.rootPath || '';
    select.replaceChildren(new Option(t('Select a history root…'), ''));
    for (const root of rootsEvent.roots || []) {
      const option = new Option(`${root.root_path} · ${integer(root.scans)} scans`, root.root_path);
      select.appendChild(option);
    }
    if ([...select.options].some(option => option.value === selected)) select.value = selected;
    await exploreHistoryTimeline();
  }

  function historyDateValue(id, end = false) {
    const value = $(id)?.value;
    if (!value) return undefined;
    const ms = new Date(`${value}T${end ? '23:59:59.999' : '00:00:00'}`).getTime();
    return Number.isFinite(ms) ? ms : undefined;
  }

  async function exploreHistoryTimeline() {
    const root = $('historyRootSelect').value;
    const generation = (state.historyTimelineGeneration || 0) + 1;
    state.historyTimelineGeneration = generation;
    state.historyTimeline = null;
    populateHistoryPairSelectors([]);
    state.historyChartHitPoints = [];
    $('historyGrowthList').replaceChildren();
    const canvas = $('historyChart');
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
    $('historyChartSummary').textContent = t('Select a root to view its timeline.');
    if (!root) return;
    const event = await makeRequest({ cmd:'history_timeline', root_path:root, start_ms:historyDateValue('historyStartDate'), end_ms:historyDateValue('historyEndDate',true), max_points:800, top_extensions:12 }, 'history_timeline', 60000);
    if (generation !== state.historyTimelineGeneration) return;
    state.historyTimeline = event.result || null;
    renderHistoryTimeline();
  }

  function renderHistoryTimeline() {
    const result = state.historyTimeline;
    const canvas = $('historyChart');
    if (!canvas || !result) return;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (!width || !height) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width*dpr); canvas.height=Math.round(height*dpr);
    const ctx=canvas.getContext('2d'); ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,width,height);
    const points=result.points||[]; state.historyChartHitPoints=[];
    if (state.historySelectorPoints !== points) {
      populateHistoryPairSelectors(points);
      renderHistoricalContributors(result);
      state.historySelectorPoints = points;
    }
    if (!points.length) { $('historyChartSummary').textContent=t('No history points in the selected range.'); ctx.fillStyle='#7d8792';ctx.font='13px sans-serif';ctx.fillText(t('No history points in the selected range.'),20,40);return; }
    const metric=$('historyMetric').value||'logical_bytes';
    const values=points.map(p=>Number(p[metric]||0)); const min=Math.min(...values); const max=Math.max(...values); const span=Math.max(1,max-min);
    const left=54,right=14,top=18,bottom=36,w=width-left-right,h=height-top-bottom;
    ctx.strokeStyle='rgba(127,139,151,.25)';ctx.lineWidth=1;for(let i=0;i<=4;i++){const y=top+h*i/4;ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(left+w,y);ctx.stroke();}
    ctx.strokeStyle='#4f8fdc';ctx.lineWidth=2;ctx.beginPath();
    points.forEach((p,i)=>{const x=left+(points.length===1?w/2:i*w/(points.length-1));const y=top+h-(Number(p[metric]||0)-min)/span*h;state.historyChartHitPoints.push({x,y,point:p});if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);});ctx.stroke();
    for(const hp of state.historyChartHitPoints){ctx.fillStyle='#dce8f5';ctx.beginPath();ctx.arc(hp.x,hp.y,3,0,Math.PI*2);ctx.fill();}
    ctx.fillStyle='#8794a2';ctx.font='11px sans-serif';ctx.fillText(formatHistoryMetric(max,metric),4,top+4);ctx.fillText(formatHistoryMetric(min,metric),4,top+h);ctx.fillText(new Date(Number(points[0].saved_ms)).toLocaleDateString(),left,height-10);ctx.textAlign='right';ctx.fillText(new Date(Number(points.at(-1).saved_ms)).toLocaleDateString(),left+w,height-10);ctx.textAlign='left';
    const first=points[0],last=points.at(-1);const delta=Number(last[metric]||0)-Number(first[metric]||0);$('historyChartSummary').textContent=`${integer(result.total_points||points.length)} stored point(s) · selected range change: ${delta>=0?'+':''}${metric.includes('bytes')?formatSize(Math.abs(delta)):`${integer(delta)}`} ${delta<0?'decrease':'increase'}`;
  }
  function formatHistoryMetric(value,metric){return metric.includes('bytes')?formatSize(value):integer(value);}
  function updateHistoryCompareState() {
    $('historyComparePairButton').disabled = !window.DiskMosaicLayout.validHistoryPair(
      $('historyBeforeSelect').value, $('historyAfterSelect').value, state.historyTimeline?.points || []);
  }
  function populateHistoryPairSelectors(points){
    const previousBefore=$('historyBeforeSelect').value, previousAfter=$('historyAfterSelect').value;
    for(const id of ['historyBeforeSelect','historyAfterSelect']){
      const select=$(id); const prior=id==='historyBeforeSelect'?previousBefore:previousAfter; select.replaceChildren();
      for(const p of points) select.appendChild(new Option(`${formatDate(p.saved_ms)} · ${formatSize(p.logical_bytes)}`,String(p.id)));
      if(prior && [...select.options].some(o=>o.value===prior)) select.value=prior;
    }
    if (points.length && !window.DiskMosaicLayout.validHistoryPair(previousBefore, previousAfter, points)) {
      $('historyBeforeSelect').value = String(points[0].id);
      $('historyAfterSelect').value = String(points.at(-1).id);
    }
    for (const [id, key] of [['historyBeforeSelect','diskmosaic.restoreHistoryBefore'], ['historyAfterSelect','diskmosaic.restoreHistoryAfter']]) {
      const restored = sessionStorage.getItem(key);
      if (restored && [...$(id).options].some(option => option.value === restored)) {
        $(id).value = restored; sessionStorage.removeItem(key);
      }
    }
    updateHistoryCompareState();
  }

  function renderHistoricalContributors(result){
    const host=$('historyGrowthList'); if(!host)return; host.replaceChildren();
    const deltas=[];
    for(const series of result.categories||[]){const first=series.points?.[0],last=series.points?.at(-1);if(!first||!last)continue;const delta=Number(last.logical_bytes||0)-Number(first.logical_bytes||0);if(delta)deltas.push({label:series.category,delta,kind:'category'});}
    for(const series of result.extensions||[]){const first=series.points?.[0],last=series.points?.at(-1);if(!first||!last)continue;const delta=Number(last.logical_bytes||0)-Number(first.logical_bytes||0);if(delta)deltas.push({label:displayExtension(series.extension),delta,kind:'extension'});}
    deltas.sort((a,b)=>Math.abs(b.delta)-Math.abs(a.delta));
    if(!deltas.length){host.appendChild(el('div','compact-result',t('No measurable category or extension change in this range.')));return;}
    for(const item of deltas.slice(0,14)){const row=el('div','compact-result');row.append(el('span','',`${item.kind==='category'?'Category':'Type'} · ${item.label}`),el('strong',item.delta>=0?'grow':'shrink',`${item.delta>=0?'+':'−'}${formatSize(Math.abs(item.delta))}`));host.appendChild(row);}
  }

  function pickHistoryPoint(event){const rect=$('historyChart').getBoundingClientRect();const x=event.clientX-rect.left,y=event.clientY-rect.top;let best=null,bestD=Infinity;for(const hp of state.historyChartHitPoints||[]){const d=(hp.x-x)**2+(hp.y-y)**2;if(d<bestD){bestD=d;best=hp;}}if(best&&bestD<225){$('historyAfterSelect').value=String(best.point.id);updateHistoryCompareState();$('historyChartSummary').textContent=`${formatDate(best.point.saved_ms)} · Logical ${formatSize(best.point.logical_bytes)} · Allocated ${formatSize(best.point.allocated_bytes)} · ${integer(best.point.files)} files`;return best.point;}return null;}
  async function compareHistoryPair(){const before=Number($('historyBeforeSelect').value),after=Number($('historyAfterSelect').value);if(!window.DiskMosaicLayout.validHistoryPair(before,after,state.historyTimeline?.points||[])){toast(t('Choose two different history snapshots.'),true);return;}const event=await makeRequest({cmd:'history_compare_pair',before_scan_id:before,after_scan_id:after,limit:2000},'history_pair_comparison',60000);state.comparisonResult=event.result;state.comparisonRows=event.result?.changes||[];compareList.setRows(state.comparisonRows);renderComparisonSummary();const host=$('historyGrowthList');host.replaceChildren();for(const item of (event.result?.changes||[]).slice(0,12)){const row=el('div','compact-result-row');const delta=Number(item.after_size||0)-Number(item.before_size||0);row.append(el('span','',item.relative_path),el('strong',delta>=0?'grow':'shrink',`${delta>=0?'+':'−'}${formatSize(Math.abs(delta))}`));host.appendChild(row);}setActiveView('compare');}

  async function runAgeAnalysis() {
    const event=await makeRequest({cmd:'age_analysis',detail_limit:10},'age_analysis',60000);state.ageAnalysis=event.result;renderAgeAnalysis();
  }
  function renderAgeAnalysis(){
    const host=$('ageBuckets'); if(!host)return; host.replaceChildren(); const result=state.ageAnalysis;
    if(!result){$('ageSummary').textContent=t('Run age analysis for the current scan.');return;}
    $('ageSummary').textContent=`${integer(result.total_files)} files · ${formatSize(result.total_logical)} logical · ${formatSize(result.total_allocated)} allocated`;
    for(const bucket of result.buckets||[]){
      const card=el('section','age-card');
      const action=el('button','age-card-action');action.type='button';action.dataset.bucket=bucket.key;
      action.append(el('strong','',bucket.label),el('span','',`${formatSize(bucket.logical_size)} logical`),el('span','',`${formatSize(bucket.allocated_size)} allocated`),el('span','',`${integer(bucket.files)} files · ${Number(bucket.percentage||0).toFixed(1)}%`));
      action.addEventListener('click',()=>filterByAgeBucket(bucket.key));card.appendChild(action);
      const files=(bucket.largest_files||[]).slice(0,3);const dirs=(bucket.largest_directories||[]).slice(0,3);
      if(files.length||dirs.length){const detail=el('div','age-card-detail');if(files.length){detail.appendChild(el('b','',t('Largest files')));for(const item of files)detail.appendChild(el('span','',`${formatSize(item.size)} · ${item.path}`));}if(dirs.length){detail.appendChild(el('b','',t('Largest containing directories')));for(const item of dirs)detail.appendChild(el('span','',`${formatSize(item.logical_size)} · ${item.path}`));}card.appendChild(detail);}
      host.appendChild(card);
    }
  }
  function filterByAgeBucket(key){clearAdvancedFilter();const map={lt7d:[undefined,6], '7_30d':[7,29], '1_6m':[30,182], '6_12m':[183,364], '1_2y':[365,729], '2_5y':[730,1824], gt5y:[1825,undefined]};if(key==='unknown'){$('searchModifiedState').value='unknown';toast(t('Unknown modification timestamps are intentionally kept explicit.'));}else{const [min,max]=map[key]||[];$('searchMinAge').value=min??'';$('searchMaxAge').value=max??'';}setActiveView('search');runSearch().catch(reportError);}


  async function runCleanupAnalysis(){const large=parseSize($('cleanupLargeSize').value);if(large==null){toast(t('Invalid cleanup size threshold.'),true);return;}const event=await makeRequest({cmd:'cleanup_candidates',rules:{old_days:Number($('cleanupOldDays').value)||730,large_bytes:large,user_paths:splitOr($('cleanupUserPaths').value),include_cache_like:$('cleanupCacheLike').checked,sparse_ratio:0.25,limit:1000}},'cleanup_candidates',60000);state.cleanupRows=event.result||[];renderCleanupCandidates();}
  function renderCleanupCandidates(){const host=$('cleanupList');host.replaceChildren();if(!state.cleanupRows.length){host.appendChild(el('div','empty-state',t('No items match the enabled deterministic cleanup rules.')));return;}for(const item of state.cleanupRows){const row=el('button','candidate-row');row.type='button';row.append(el('strong','',item.path),el('span','',`${formatSize(item.logical_size)} logical · ${formatSize(item.allocated_size)} allocated · ${formatDate(item.modified_ms)}`),el('small','',item.reasons.join(' · ')));row.addEventListener('click',async()=>{const event=await makeRequest({cmd:'get_node',node_id:item.id},'node');if(event.node)await revealNodeInTree(event.node);});host.appendChild(row);}}

  async function runAllocationAnalysis() {
    // Model analyses are serialized by the engine; request their results in order.
    const event = await makeRequest({cmd:'allocation_analysis',sort:$('allocationSort').value,descending:true,limit:2000},'allocation_analysis',60000);
    state.allocationRows = event.result || [];
    renderAllocationAnalysis();
    const fsEvent = await makeRequest({cmd:'filesystem_context'},'filesystem_context',30000);
    renderFilesystemContext(fsEvent);
  }
  function renderAllocationAnalysis(){const host=$('allocationList');host.replaceChildren();for(const item of state.allocationRows){const ratio=item.ratio==null?'—':`${(Number(item.ratio)*100).toFixed(1)}%`;const attrs=[item.sparse===true?'Sparse':null,item.compressed===true?'Compressed':null].filter(Boolean).join(', ')||'Metadata does not assert sparse/compressed';const row=el('div','allocation-row');row.append(el('span','',item.path),el('span','numeric',formatSize(item.logical_size)),el('span','numeric',formatSize(item.allocated_size)),el('span','numeric',`${Number(item.difference)>=0?'+':'−'}${formatSize(Math.abs(Number(item.difference)))}`),el('span','numeric',ratio),el('span','',attrs));row.addEventListener('dblclick',()=>api.openPath(item.path).catch(reportError));host.appendChild(row);}}
  function renderFilesystemContext(event){const c=event.context||{};const total=c.total_bytes;const free=c.available_bytes;const used=event.used_bytes;$('filesystemContext').textContent=`Filesystem ${c.filesystem||'Unknown'} · Volume ${c.volume||'Unknown'} · Capacity ${total==null?'Unknown':formatSize(total)} · Used ${used==null?'Unknown':formatSize(used)} · Free ${free==null?'Unknown':formatSize(free)} · Scan logical ${formatSize(event.scan_logical)} · Scan allocated ${formatSize(event.scan_allocated)}${event.unaccounted_bytes==null?'':` · Unaccounted difference ${formatSize(event.unaccounted_bytes)}`} — ${event.unaccounted_explanation||''}`;}

  async function loadIssuesCenter(){const event=await makeRequest({cmd:'issues_summary',paths_per_group:30},'issues_summary',30000);state.issues=event.result||[];renderIssuesCenter();}
  function renderIssuesCenter(){const host=$('issuesCenter');host.replaceChildren();if(!state.issues.length){host.appendChild(el('div','empty-state',t('No retained scan issues.')));return;}for(const group of state.issues){const card=el('section','issue-card');card.append(el('strong','',`${group.category} · ${integer(group.count)}`),el('span','',group.affects_completeness?t('May affect scan completeness'):t('Informational/non-fatal during a live filesystem scan')));for(const path of group.paths||[]){const line=el('button','issue-path',path);line.type='button';line.addEventListener('click',()=>{$('searchPath').value=path;setActiveView('search');runSearch().catch(reportError);});card.appendChild(line);}host.appendChild(card);}}

  async function loadDiagnostics(){const event=await makeRequest({cmd:'diagnostics'},'diagnostics',30000);state.diagnostics=event.diagnostics||{};$('diagnosticsText').textContent=Object.entries(state.diagnostics).map(([k,v])=>`${k.replaceAll('_',' ').padEnd(22)} ${v}`).join('\n');}

  function htmlEscape(value){return String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));}
  function storageInsightTexts(){return [...document.querySelectorAll('#storageInsights .insight-item,#storageInsights button')].slice(0,40).map(node=>node.textContent.trim()).filter(Boolean);}
  function reportData(){return {application:'DiskMosaic',version:'1.0.0',generated_at:new Date().toISOString(),root:state.rootPath,summary:state.summary,filesystem_context:$('filesystemContext')?.textContent||'',top_directories:state.reportTopDirectories.slice(0,50),largest_files:state.largestRows.slice(0,100),extension_distribution:state.extensionStats.slice(0,500),category_distribution:categoryStatistics(),age_distribution:state.ageAnalysis?.buckets||[],duplicate_summary:state.duplicateResult?{groups:state.duplicateResult.groups?.length||0,recoverable_logical:state.duplicateResult.recoverable_logical,recoverable_allocated:state.duplicateResult.recoverable_allocated}:null,allocation_efficiency:state.allocationRows.slice(0,100),storage_insights:storageInsightTexts(),issues:state.issues,comparison:state.comparisonResult?{logical_delta:state.comparisonResult.logical_delta,allocated_delta:state.comparisonResult.allocated_delta,files_added:state.comparisonResult.files_added,files_removed:state.comparisonResult.files_removed,files_changed:state.comparisonResult.files_changed,changes:(state.comparisonResult.changes||[]).slice(0,100)}:null,treemap_snapshot:state.rootNode?$('treemapCanvas').toDataURL('image/png'):null};}
  function reportRows(items,make){return (items||[]).map(make).join('');}
  function buildHtmlReport(data){
    const largest=reportRows(data.largest_files,x=>`<tr><td>${htmlEscape(x.path)}</td><td>${htmlEscape(formatSize(x.size))}</td><td>${htmlEscape(formatSize(x.allocated_size??x.size))}</td></tr>`);
    const topDirs=reportRows(data.top_directories,x=>`<tr><td>${htmlEscape(x.path||x.name)}</td><td>${htmlEscape(formatSize(x.size))}</td><td>${htmlEscape(formatSize(x.allocated_size??x.size))}</td></tr>`);
    const categories=reportRows(data.category_distribution,x=>`<tr><td>${htmlEscape(x.category||x.label)}</td><td>${htmlEscape(integer(x.files))}</td><td>${htmlEscape(formatSize(x.size))}</td><td>${htmlEscape(formatSize(x.allocated_size??x.size))}</td></tr>`);
    const extensions=reportRows((data.extension_distribution||[]).slice(0,80),x=>`<tr><td>${htmlEscape(x.extension||'(none)')}</td><td>${htmlEscape(integer(x.files))}</td><td>${htmlEscape(formatSize(x.size))}</td></tr>`);
    const age=reportRows(data.age_distribution,x=>`<tr><td>${htmlEscape(x.label)}</td><td>${htmlEscape(formatSize(x.logical_size))}</td><td>${htmlEscape(formatSize(x.allocated_size))}</td><td>${htmlEscape(integer(x.files))}</td><td>${htmlEscape(Number(x.percentage||0).toFixed(1))}%</td></tr>`);
    const allocation=reportRows((data.allocation_efficiency||[]).slice(0,50),x=>`<tr><td>${htmlEscape(x.path)}</td><td>${htmlEscape(formatSize(x.logical_size))}</td><td>${htmlEscape(formatSize(x.allocated_size))}</td><td>${htmlEscape(x.ratio==null?'—':`${(Number(x.ratio)*100).toFixed(1)}%`)}</td><td>${htmlEscape([x.sparse===true?'Sparse':'',x.compressed===true?'Compressed':''].filter(Boolean).join(', ')||'Allocation difference')}</td></tr>`);
    const dup=data.duplicate_summary?`${integer(data.duplicate_summary.groups)} groups · ${formatSize(data.duplicate_summary.recoverable_logical)} recoverable logical · ${formatSize(data.duplicate_summary.recoverable_allocated)} recoverable allocated`:'Not analyzed';
    const image=data.treemap_snapshot?`<img class="treemap" src="${data.treemap_snapshot}" alt="Treemap snapshot">`:'';
    const insights=(data.storage_insights||[]).map(x=>`<li>${htmlEscape(x)}</li>`).join('')||'<li>No retained insight text.</li>';
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>DiskMosaic 1.0.0 report</title><style>:root{font-family:system-ui,sans-serif;color:#17202a;background:#fff}body{max-width:1200px;margin:0 auto;padding:32px;line-height:1.4}h1,h2{margin:.7em 0 .35em}.meta{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px}.card{border:1px solid #cbd5df;border-radius:10px;padding:14px;overflow-wrap:anywhere}table{width:100%;border-collapse:collapse;font-size:14px}th,td{text-align:left;padding:7px;border-bottom:1px solid #e2e8ef;vertical-align:top;overflow-wrap:anywhere}.treemap{max-width:100%;border:1px solid #ccd}small{color:#5d6874}@media(prefers-color-scheme:dark){:root{color:#e8eef5;background:#111820}.card{border-color:#394653}th,td{border-color:#34414d}}</style></head><body><h1>DiskMosaic 1.0.0 storage report</h1><small>Generated ${htmlEscape(data.generated_at)} · Self-contained offline report</small><section class="meta"><div class="card"><strong>Scan root</strong><br>${htmlEscape(data.root||'—')}</div><div class="card"><strong>Logical</strong><br>${htmlEscape(formatSize(data.summary?.bytes||0))}</div><div class="card"><strong>Allocated</strong><br>${htmlEscape(formatSize(data.summary?.allocated_bytes||0))}</div><div class="card"><strong>Files / directories</strong><br>${htmlEscape(integer(data.summary?.files||0))} / ${htmlEscape(integer(data.summary?.directories||0))}</div></section><h2>Filesystem information</h2><p>${htmlEscape(data.filesystem_context||'Not loaded')}</p><h2>Treemap</h2>${image}<h2>Top directories</h2><table><thead><tr><th>Path</th><th>Logical</th><th>Allocated</th></tr></thead><tbody>${topDirs}</tbody></table><h2>Largest files</h2><table><thead><tr><th>Path</th><th>Logical</th><th>Allocated</th></tr></thead><tbody>${largest}</tbody></table><h2>Category distribution</h2><table><thead><tr><th>Category</th><th>Files</th><th>Logical</th><th>Allocated</th></tr></thead><tbody>${categories}</tbody></table><h2>Extension distribution</h2><table><thead><tr><th>Extension</th><th>Files</th><th>Logical</th></tr></thead><tbody>${extensions}</tbody></table><h2>File age distribution</h2><table><thead><tr><th>Age</th><th>Logical</th><th>Allocated</th><th>Files</th><th>Share</th></tr></thead><tbody>${age}</tbody></table><h2>Duplicates</h2><p>${htmlEscape(dup)}</p><h2>Allocation efficiency</h2><table><thead><tr><th>Path</th><th>Logical</th><th>Allocated</th><th>Ratio</th><th>Metadata</th></tr></thead><tbody>${allocation}</tbody></table><h2>Storage Insights</h2><ul>${insights}</ul><h2>Issues</h2><p>${htmlEscape((data.issues||[]).map(x=>`${x.category}: ${x.count}${x.affects_completeness?' (may affect completeness)':''}`).join(' · ')||'None retained')}</p><h2>Comparison</h2><p>${htmlEscape(data.comparison?`Logical delta ${data.comparison.logical_delta}; allocated delta ${data.comparison.allocated_delta}; files added ${data.comparison.files_added}; removed ${data.comparison.files_removed}; changed ${data.comparison.files_changed}`:'No comparison active')}</p><p><small>This report contains no remote script, stylesheet, font, image, CDN or runtime API dependency.</small></p></body></html>`;
  }
  function csvCell(value) {
    let text = String(value ?? '');
    // Quoting protects CSV structure but does not disable spreadsheet formulas.
    if (typeof value === 'string' && (/^[\t\r\n]/.test(text) || /^\s*[=+\-@]/.test(text))) text = `'${text}`;
    return `"${text.replaceAll('"','""')}"`;
  }
  function buildCsvReport(data){const rows=[['section','name_or_path','logical_bytes','allocated_bytes','files','details']];for(const x of data.top_directories||[])rows.push(['top_directory',x.path||x.name,x.size,x.allocated_size??x.size,x.file_count??'','']);for(const x of data.largest_files||[])rows.push(['largest_file',x.path,x.size,x.allocated_size??x.size,1,x.modified_ms??'']);for(const x of data.category_distribution||[])rows.push(['category',x.category||x.label,x.size,x.allocated_size??x.size,x.files,'']);for(const x of data.extension_distribution||[])rows.push(['extension',x.extension,x.size,x.allocated_size??x.size,x.files,'']);for(const x of data.age_distribution||[])rows.push(['age',x.label,x.logical_size,x.allocated_size,x.files,`${Number(x.percentage||0).toFixed(1)}%`]);for(const x of data.allocation_efficiency||[])rows.push(['allocation',x.path,x.logical_size,x.allocated_size,1,x.ratio==null?'':`${(Number(x.ratio)*100).toFixed(3)}%`]);return rows.map(row=>row.map(csvCell).join(',')).join('\n');}
  function buildMarkdownReport(data){const cats=(data.category_distribution||[]).slice(0,20).map(x=>`- ${x.category||x.label}: ${formatSize(x.size)} (${integer(x.files)} files)`).join('\n');const ages=(data.age_distribution||[]).map(x=>`- ${x.label}: ${formatSize(x.logical_size)} logical / ${formatSize(x.allocated_size)} allocated — ${integer(x.files)} files`).join('\n');const alloc=(data.allocation_efficiency||[]).slice(0,20).map(x=>`- ${formatSize(x.logical_size)} logical / ${formatSize(x.allocated_size)} allocated — \`${String(x.path||'').replaceAll('`','\\`')}\``).join('\n');return `# DiskMosaic 1.0.0 storage report\n\nGenerated: ${data.generated_at}\n\n- Root: \`${String(data.root||'—').replaceAll('`','\\`')}\`\n- Logical: ${formatSize(data.summary?.bytes||0)}\n- Allocated: ${formatSize(data.summary?.allocated_bytes||0)}\n- Files: ${integer(data.summary?.files||0)}\n- Directories: ${integer(data.summary?.directories||0)}\n- Duplicate groups: ${integer(data.duplicate_summary?.groups||0)}\n\n## Largest files\n\n${(data.largest_files||[]).slice(0,50).map(x=>`- ${formatSize(x.size)} — \`${String(x.path||'').replaceAll('`','\\`')}\``).join('\n')}\n\n## Categories\n\n${cats}\n\n## Age distribution\n\n${ages}\n\n## Allocation efficiency\n\n${alloc}\n\n## Storage Insights\n\n${(data.storage_insights||[]).map(x=>`- ${x}`).join('\n')||'No retained insight text.'}\n\n## Issues\n\n${(data.issues||[]).map(x=>`- ${x.category}: ${x.count}`).join('\n')||'None retained.'}\n`;}
  async function exportProfessionalReport(format='html'){if(!state.rootNode){toast(t('Load a scan before exporting a report.'),true);return;}await loadLargest();await runAgeAnalysis();await runAllocationAnalysis();await loadIssuesCenter();try{const dirs=await makeRequest({cmd:'children',parent_id:state.rootNode.id,offset:0,limit:50,sort:state.sizeBasis==='allocated'?'allocated':'logical',descending:true,hidden_mode:hiddenDisplayMode()},'children',30000);state.reportTopDirectories=(dirs.items||[]).filter(x=>x.kind==='directory').slice(0,50);}catch(_){state.reportTopDirectories=[];}const data=reportData();let content,ext;if(format==='html'){content=buildHtmlReport(data);ext='html';}else if(format==='csv'){content=buildCsvReport(data);ext='csv';}else if(format==='markdown'){content=buildMarkdownReport(data);ext='md';}else{content=JSON.stringify(data,null,2);ext='json';}const leaf=(state.rootNode?.name||'scan').replace(/[^a-z0-9._-]+/gi,'_');const saved=await api.saveTextFile({suggestedName:`DiskMosaic-${leaf}-${new Date().toISOString().slice(0,10)}.${ext}`,content});if(saved)toast(`${t('Report saved')}: ${saved}`);}


  function persistWorkspaceState(){const active=document.querySelector('.tab.active')?.dataset.view||'directory';const payload={activeView:active,settingsSection:state.activeSettingsSection,treemapVisualization:state.settings?.treemapVisualization,treemapParent:state.treemapParent,treeWidth:state.settings?.treeWidth,topHeight:state.settings?.topHeight,smartCollection:$('smartCollectionSelect')?.value||'',historyRoot:$('historyRootSelect')?.value||'',historyBefore:$('historyBeforeSelect')?.value||'',historyAfter:$('historyAfterSelect')?.value||'',historyStart:$('historyStartDate')?.value||'',historyEnd:$('historyEndDate')?.value||'',historyMetric:$('historyMetric')?.value||'logical_bytes',filters:state.rootNode?buildAdvancedFilterQuerySafe():null};localStorage.setItem('diskmosaic.workspace',JSON.stringify(payload));}
  function buildAdvancedFilterQuerySafe(){try{return buildAdvancedFilterQuery();}catch(_){return null;}}
  function restoreWorkspaceState(){try{const w=JSON.parse(localStorage.getItem('diskmosaic.workspace')||'{}');if(w.activeView&&document.getElementById(`${w.activeView}View`))setActiveView(w.activeView);if(w.settingsSection)state.activeSettingsSection=w.settingsSection;if(w.smartCollection&&$('smartCollectionSelect'))$('smartCollectionSelect').value=w.smartCollection;if(w.historyRoot&&$('historyRootSelect'))$('historyRootSelect').value=w.historyRoot;if(w.historyStart)$('historyStartDate').value=w.historyStart;if(w.historyEnd)$('historyEndDate').value=w.historyEnd;if(w.historyMetric)$('historyMetric').value=w.historyMetric;if(w.historyBefore)sessionStorage.setItem('diskmosaic.restoreHistoryBefore',w.historyBefore);if(w.historyAfter)sessionStorage.setItem('diskmosaic.restoreHistoryAfter',w.historyAfter);if(w.treemapVisualization){state.settings.treemapVisualization=w.treemapVisualization==='extruded3d'?'extruded3d':'cushioned2d';}if(w.filters)applyFilterToForm(w.filters);}catch(_){} }

  function categoryStatistics() {
    const byName = new Map(buildCategoryModel().categories.map(category => [category.name, {
      extension: category.name, label: category.name, category: category.name, color: category.color, files: 0, size: 0, allocated_size: 0,
    }]));
    for (const stat of state.extensionStats) {
      const category = categoryForExtension(stat.extension);
      const row = byName.get(category.name);
      row.files += Number(stat.files || 0);
      row.size += Number(stat.size || 0);
      row.allocated_size += Number(stat.allocated_size ?? stat.size ?? 0);
    }
    return [...byName.values()].filter(row => row.files > 0 || row.size > 0);
  }

  function currentTypeStats() {
    if (state.typeMode === 'category') return categoryStatistics();
    return state.extensionStats.map(stat => ({ ...stat, label: displayExtension(stat.extension), color: colorForExtension(stat.extension) }));
  }

  function renderExtensions() {
    const stats = currentTypeStats();
    const { field, descending } = state.extensionSort;
    stats.sort((a, b) => {
      let cmp;
      if (field === 'extension') cmp = String(a.label || a.extension).localeCompare(String(b.label || b.extension));
      else if (field === 'size') {
        const av = state.sizeBasis === 'allocated' ? Number(a.allocated_size ?? a.size ?? 0) : Number(a.size || 0);
        const bv = state.sizeBasis === 'allocated' ? Number(b.allocated_size ?? b.size ?? 0) : Number(b.size || 0);
        cmp = av - bv;
      } else cmp = Number(a[field] || 0) - Number(b[field] || 0);
      return descending ? -cmp : cmp;
    });
    extensionList.setRows(stats);
    const hasFilter = hasActiveTypeFilter();
    $('clearExtensionFilter').classList.toggle('hidden', !hasFilter);
    const selected = state.typeMode === 'category' ? state.activeCategories : state.activeExtensions;
    if (selected.length) {
      const labels = state.typeMode === 'category' ? selected : selected.map(displayExtension);
      const summary = labels.length <= 3 ? labels.map(label => state.typeMode === 'category' ? t(label) : label).join(', ') : `${labels.slice(0, 3).map(label => state.typeMode === 'category' ? t(label) : label).join(', ')} +${labels.length - 3}`;
      $('extensionHint').textContent = t('Highlighting {count} {type}: {summary}', { count: labels.length, type: state.typeMode === 'category' ? t(labels.length === 1 ? 'Category' : 'Categories') : t(labels.length === 1 ? 'Extension' : 'Extensions'), summary });
      $('extensionHint').title = labels.join(', ');
    } else {
      $('extensionHint').textContent = t('Click a type to highlight it · Ctrl+Click to multi-select');
      $('extensionHint').title = '';
    }
    $('typeStatsTitle').textContent = state.typeMode === 'category' ? t('Category statistics') : t('Extension statistics');
    $('typeHeaderLabel').textContent = state.typeMode === 'category' ? t('Category') : t('Extension');
    $('showExtensionsButton').classList.toggle('active', state.typeMode === 'extension');
    $('showCategoriesButton').classList.toggle('active', state.typeMode === 'category');
  }

  function renderExtensionRow(stat) {
    const line = el('div', 'virtual-row extension-row');
    const isActive = state.typeMode === 'category'
      ? state.activeCategories.includes(stat.category)
      : state.activeExtensions.includes(stat.extension);
    if (isActive) line.classList.add('active-filter');
    const name = el('div', 'ext-name');
    const chip = el('span', 'color-chip');
    chip.style.background = stat.color || (stat.category ? categoryForExtension('').color : colorForExtension(stat.extension));
    name.append(chip, el('span', '', stat.label ? t(stat.label) : displayExtension(stat.extension)));
    const files = el('span', 'numeric', integer(stat.files));
    const statBytes = state.sizeBasis === 'allocated' ? Number(stat.allocated_size ?? stat.size ?? 0) : Number(stat.size || 0);
    const size = el('span', 'numeric', formatSize(statBytes));
    size.title = `Logical: ${formatSize(stat.size || 0)} · Allocated: ${formatSize(stat.allocated_size ?? stat.size ?? 0)}`;
    const rootBytes = rootBasisSize();
    const pct = rootBytes ? (statBytes / rootBytes) * 100 : 0;
    const percent = el('span', 'numeric', `${pct.toFixed(pct >= 10 ? 1 : 2)}%`);
    line.append(name, files, size, percent);
    line.addEventListener('click', event => {
      if (state.typeMode === 'category') {
        state.activeExtensions = [];
        state.activeCategories = updateTypeSelection(state.activeCategories, stat.category, event.ctrlKey || event.metaKey);
      } else {
        state.activeCategories = [];
        state.activeExtensions = updateTypeSelection(state.activeExtensions, stat.extension, event.ctrlKey || event.metaKey);
      }
      renderExtensions();
      refreshTreemapTypeFilter().catch(reportError);
    });
    return line;
  }

  function renderStatistics() {
    const cards = $('statisticsCards');
    const sizeHost = $('sizeDistribution');
    const ageHost = $('ageDistribution');
    const insightsHost = $('storageInsights');
    if (!cards || !sizeHost || !ageHost || !insightsHost) return;
    cards.replaceChildren();
    sizeHost.replaceChildren();
    ageHost.replaceChildren();
    insightsHost.replaceChildren();
    if (!state.rootNode || !state.statistics) {
      cards.appendChild(el('div', 'muted', 'Complete a scan to view analysis statistics.'));
      return;
    }
    const volumeTotal = Number(state.summary?.filesystem_total_bytes || 0);
    const volumeAvailable = Number(state.summary?.filesystem_available_bytes || 0);
    const volumeUsed = Number(state.summary?.filesystem_used_bytes || 0);
    const scanned = Number(state.summary?.bytes || 0);
    const allocated = Number(state.summary?.allocated_bytes ?? scanned);
    const metrics = [
      [formatSize(scanned), 'Logical size'],
      [formatSize(allocated), 'Allocated size'],
      [integer(state.summary?.files || 0), 'Files'],
      [integer(state.summary?.directories || 0), 'Directories'],
      [integer(state.statistics.max_depth || 0), 'Maximum depth'],
      [integer(state.statistics.hardlink_duplicates || 0), 'Hard-link duplicates'],
      [integer(state.summary?.excluded || 0), 'Excluded entries'],
      [integer(state.statistics.extensionless_files || 0), 'Extensionless files'],
      [integer(state.summary?.errors || 0), 'Scan errors'],
    ];
    if (volumeTotal > 0) {
      metrics.push([formatSize(volumeTotal), 'Filesystem capacity']);
      metrics.push([formatSize(volumeAvailable), 'Filesystem available']);
      // A scan may cross mount/filesystem boundaries. Only present this ratio when the
      // scanned bytes can actually fit inside the root filesystem's used-byte figure;
      // otherwise the comparison would be misleading.
      if (volumeUsed > 0 && scanned <= volumeUsed) {
        const share = scanned / volumeUsed * 100;
        metrics.push([`${share.toFixed(share >= 10 ? 1 : 2)}%`, 'Scan root / filesystem used']);
      }
    }
    for (const [value, label] of metrics) {
      const card = el('div', 'metric-card');
      card.append(el('strong', '', value), el('span', '', label));
      cards.appendChild(card);
    }
    renderStorageInsights(insightsHost);
    renderDistribution(sizeHost, state.statistics.size_buckets || [], 'size');
    renderDistribution(ageHost, state.statistics.age_buckets || [], 'age');
  }

  function renderStorageInsights(host) {
    host.replaceChildren();
    const insights = [];
    const logical = Number(state.summary?.bytes || 0);
    const allocated = Number(state.summary?.allocated_bytes ?? logical);
    const rootChildren = state.treeRows.filter(row => row.type === 'node' && row.depth === 1).map(row => row.node);
    const largestDir = rootChildren.filter(node => node.kind === 'directory').sort((a, b) => basisSize(b) - basisSize(a))[0];
    if (largestDir && rootBasisSize() > 0) {
      const pct = basisSize(largestDir) / rootBasisSize() * 100;
      insights.push({
        text: `${largestDir.name} is the largest top-level directory at ${formatSize(basisSize(largestDir))} (${pct.toFixed(1)}% by ${state.sizeBasis} size).`,
        action: () => { selectNode(largestDir); focusTreemap(largestDir.id, true).catch(reportError); },
      });
    }
    const typeStats = categoryStatistics().sort((a, b) => {
      const av = state.sizeBasis === 'allocated' ? Number(a.allocated_size || 0) : Number(a.size || 0);
      const bv = state.sizeBasis === 'allocated' ? Number(b.allocated_size || 0) : Number(b.size || 0);
      return bv - av;
    });
    const topType = typeStats[0];
    if (topType && rootBasisSize() > 0) {
      const bytes = state.sizeBasis === 'allocated' ? Number(topType.allocated_size || 0) : Number(topType.size || 0);
      insights.push({
        text: `${topType.category} is the largest file category at ${formatSize(bytes)} (${(bytes / rootBasisSize() * 100).toFixed(1)}%).`,
        action: () => { state.typeMode = 'category'; state.activeCategories = [topType.category]; state.activeExtensions = []; renderExtensions(); refreshTreemapTypeFilter().catch(reportError); },
      });
    }
    const veryLarge = (state.statistics?.size_buckets || []).slice(6).reduce((sum, bucket) => sum + Number(bucket.files || 0), 0);
    const veryLargeBytes = (state.statistics?.size_buckets || []).slice(6).reduce((sum, bucket) => sum + Number(bucket.size || 0), 0);
    if (veryLarge > 0) {
      insights.push({ text: `${integer(veryLarge)} files of at least 1 GiB account for ${formatSize(veryLargeBytes)}.`, action: () => {
        $('searchName').value = ''; $('searchPath').value = ''; $('searchExtension').value = ''; $('searchKind').value = 'file';
        $('searchMinSize').value = '1 GiB'; $('searchMaxSize').value = ''; $('searchModifiedAfter').value = ''; $('searchModifiedBefore').value = '';
        setActiveView('search'); runSearch().catch(reportError);
      } });
    }
    const oldBuckets = state.statistics?.age_buckets || [];
    const oldFiles = oldBuckets.slice(5, 7).reduce((sum, bucket) => sum + Number(bucket.files || 0), 0);
    const oldBytes = oldBuckets.slice(5, 7).reduce((sum, bucket) => sum + Number(bucket.size || 0), 0);
    if (oldFiles > 0) {
      insights.push({ text: `${integer(oldFiles)} files not modified for at least one year occupy ${formatSize(oldBytes)}.`, action: () => {
        $('searchName').value = ''; $('searchPath').value = ''; $('searchExtension').value = ''; $('searchKind').value = 'file';
        $('searchMinSize').value = ''; $('searchMaxSize').value = ''; $('searchModifiedAfter').value = '';
        $('searchModifiedBefore').value = dateInputValue(Date.now() - 365 * 86_400_000);
        setActiveView('search'); runSearch().catch(reportError);
      } });
    }
    if (allocated !== logical) {
      const diff = allocated - logical;
      const relation = diff < 0 ? 'less' : 'more';
      insights.push({ text: `Allocated size is ${formatSize(Math.abs(diff))} ${relation} than logical size, indicating filesystem allocation/compression/sparse-file effects.` });
    }
    if (state.duplicateResult?.groups?.length) {
      const recoverable = state.sizeBasis === 'allocated'
        ? Number(state.duplicateResult.recoverable_allocated || 0)
        : Number(state.duplicateResult.recoverable_logical || 0);
      insights.push({ text: `Verified duplicate groups could recover about ${formatSize(recoverable)} by ${state.sizeBasis} size if one copy per group were retained.`, action: () => setActiveView('duplicates') });
    }
    if (state.comparisonResult) {
      const before = state.sizeBasis === 'allocated' ? Number(state.comparisonResult.before_allocated || 0) : Number(state.comparisonResult.before_logical || 0);
      const after = state.sizeBasis === 'allocated' ? Number(state.comparisonResult.after_allocated || 0) : Number(state.comparisonResult.after_logical || 0);
      const delta = after - before;
      insights.push({ text: `Compared with the selected saved scan, this root ${delta >= 0 ? 'grew' : 'shrank'} by ${formatSize(Math.abs(delta))}.`, action: () => setActiveView('compare') });
    }
    if (!insights.length) insights.push({ text: 'No strong storage pattern stands out yet. Explore the treemap, categories, largest files, or run duplicate analysis.' });
    for (const insight of insights.slice(0, 7)) {
      const row = insight.action ? el('button', 'insight-row actionable') : el('div', 'insight-row');
      if (row instanceof HTMLButtonElement) row.type = 'button';
      row.append(el('span', 'insight-mark', '◆'), el('span', '', insight.text));
      if (insight.action) row.addEventListener('click', insight.action);
      host.appendChild(row);
    }
  }

  function dateInputValue(timestamp) {
    const date = new Date(timestamp);
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function applyDistributionSearch(kind, index) {
    $('searchName').value = '';
    $('searchPath').value = '';
    $('searchExtension').value = '';
    $('searchKind').value = 'file';
    $('searchMinSize').value = '';
    $('searchMaxSize').value = '';
    $('searchModifiedAfter').value = '';
    $('searchModifiedBefore').value = '';

    if (kind === 'size') {
      const ranges = [
        [0, 0], [1, 4095], [4096, 1_048_575], [1_048_576, 10_485_759],
        [10_485_760, 104_857_599], [104_857_600, 1_073_741_823],
        [1_073_741_824, 10_737_418_239], [10_737_418_240, null],
      ];
      const [min, max] = ranges[index] || [null, null];
      if (min != null) $('searchMinSize').value = `${min} B`;
      if (max != null) $('searchMaxSize').value = `${max} B`;
    } else if (kind === 'age') {
      const DAY = 86_400_000;
      const now = Date.now();
      const ranges = [
        [now - DAY, null], [now - 7 * DAY, now - DAY], [now - 30 * DAY, now - 7 * DAY],
        [now - 90 * DAY, now - 30 * DAY], [now - 365 * DAY, now - 90 * DAY],
        [now - 3 * 365 * DAY, now - 365 * DAY], [null, now - 3 * 365 * DAY], [null, null],
      ];
      const [after, before] = ranges[index] || [null, null];
      if (after != null) $('searchModifiedAfter').value = dateInputValue(after);
      if (before != null) $('searchModifiedBefore').value = dateInputValue(before);
      if (index === 7) {
        toast(t('Files with unknown modification times cannot be represented by the date controls.'), true);
        return;
      }
    }
    setActiveView('search');
    runSearch().catch(reportError);
  }

  function renderDistribution(host, buckets, kind) {
    const totalBytes = Math.max(1, Number(state.rootNode?.size || 0));
    for (const bucket of buckets) {
      const row = el('button', 'distribution-row distribution-action');
      row.type = 'button';
      row.title = 'Search files in this bucket';
      const label = el('span', 'distribution-label', bucket.label || '—');
      const track = el('div', 'distribution-track');
      const fill = el('span', 'distribution-fill');
      const pct = Math.max(0, Math.min(100, Number(bucket.size || 0) / totalBytes * 100));
      fill.style.width = `${pct}%`;
      track.appendChild(fill);
      track.title = `${pct.toFixed(pct >= 10 ? 1 : 2)}% of scanned bytes`;
      const size = el('span', 'distribution-size', formatSize(bucket.size || 0));
      const files = el('span', 'distribution-files', `${integer(bucket.files || 0)} files`);
      row.append(label, track, size, files);
      const index = buckets.indexOf(bucket);
      row.addEventListener('click', () => applyDistributionSearch(kind, index));
      host.appendChild(row);
    }
  }

  function treemapFocusCandidate(node = state.selectedNode) {
    if (!node) return null;
    if (node.kind === 'directory') return node.id;
    return node.parent_id ?? null;
  }

  function updateTreemapControls() {
    const loaded = !!state.rootNode;
    $('treemapRootButton').disabled = !loaded || state.treemapParent === 0;
    const candidate = treemapFocusCandidate();
    $('treemapFocusButton').disabled = !loaded || candidate == null || candidate === state.treemapParent;
    $('treemapModeButton').disabled = !state.comparisonResult;
    $('treemapModeButton').textContent = state.treemapMode === 'delta' ? t('Delta') : t('Current');
    $('treemapModeButton').classList.toggle('active', state.treemapMode === 'delta');
    $('treemapExpandButton').textContent = state.treemapMaximized ? t('Restore') : t('Maximize');
    $('treemapExpandButton').title = state.treemapMaximized ? t('Restore split view (F9 or Esc)') : t('Maximize treemap (F9)');
  }

  function hasActiveTypeFilter() {
    return state.activeExtensions.length > 0 || state.activeCategories.length > 0;
  }

  function updateTypeSelection(current, value, additive) {
    const normalized = String(value ?? '');
    if (!additive) {
      return current.length === 1 && current[0] === normalized ? [] : [normalized];
    }
    return current.includes(normalized)
      ? current.filter(item => item !== normalized)
      : [...current, normalized];
  }

  function currentTreemapFilterExtensions() {
    const wanted = new Set(state.activeExtensions.map(normalizeCategoryExtension));
    if (state.activeCategories.length) {
      const categories = new Set(state.activeCategories);
      for (const stat of state.extensionStats) {
        if (categories.has(categoryForExtension(stat.extension).name)) {
          wanted.add(normalizeCategoryExtension(stat.extension));
        }
      }
    }
    return [...wanted];
  }

  async function refreshTreemapTypeFilter() {
    if (!state.rootNode) {
      drawTreemap();
      return;
    }
    await focusTreemap(state.treemapParent, false);
  }

  async function focusTreemap(nodeId, pushHistory = true) {
    if (!state.rootNode) return;
    if (pushHistory && state.treemapParent !== nodeId) {
      state.navBack.push(state.treemapParent);
      if (state.navBack.length > 200) state.navBack.shift();
      state.navForward = [];
    }
    const event = await makeRequest({
      cmd: 'treemap', parent_id: nodeId,
      max_items: clamp(state.settings.treemapMaxItems, 100, 10000), min_bytes: 0, size_basis: state.sizeBasis,
      filter_extensions: currentTreemapFilterExtensions(), hidden_mode: hiddenDisplayMode(),
    }, 'treemap');
    if (!event.parent) throw new Error('Treemap focus target is no longer available');
    state.treemapParent = nodeId;
    state.treemapParentNode = event.parent;
    state.treemapItems = event.items || [];
    state.treemapHover = null;
    $('treemapHoverFrame').classList.add('hidden');
    $('treemapTooltip').classList.add('hidden');
    $('treemapScope').textContent = event.parent.path || '';
    $('treemapScope').title = event.parent.path || '';
    await renderBreadcrumbs(event.parent);
    const directories = state.treemapItems.filter(item => item.kind === 'directory').length;
    const leaves = state.treemapItems.filter(item => item.id != null && item.kind !== 'directory').length;
    const aggregates = state.treemapItems.filter(item => item.kind === 'aggregate').length;
    const aggregatedObjects = state.treemapItems
      .filter(item => item.kind === 'aggregate')
      .reduce((sum, item) => sum + Number(item.aggregated_items || 0), 0);
    $('treemapCount').textContent = `${integer(directories)} directory groups · ${integer(leaves)} item tiles${aggregates ? ` · ${integer(aggregates)} remainder${aggregates === 1 ? '' : 's'}` : ''}`;
    $('treemapCount').title = aggregatedObjects
      ? `Hierarchical layout. ${integer(aggregatedObjects)} lower-priority filesystem objects are represented by bounded remainder rectangles.`
      : 'Hierarchical layout. Rectangle area is proportional to disk usage within the focused scan scope.';
    $('treemapEmpty').classList.toggle('hidden', state.treemapItems.length > 0 || state.scanning);
    $('backButton').disabled = state.navBack.length === 0;
    $('forwardButton').disabled = state.navForward.length === 0;
    $('parentButton').disabled = event.parent.parent_id == null;
    updateTreemapControls();
    drawTreemap();
  }

  async function focusTreemapRoot() {
    if (!state.rootNode) return;
    await focusTreemap(0, state.treemapParent !== 0);
  }

  async function navigateBack() {
    if (!state.navBack.length) return;
    const target = state.navBack.pop();
    state.navForward.push(state.treemapParent);
    await focusTreemap(target, false);
  }

  async function navigateForward() {
    if (!state.navForward.length) return;
    const target = state.navForward.pop();
    state.navBack.push(state.treemapParent);
    await focusTreemap(target, false);
  }

  async function navigateParent() {
    if (state.treemapParentNode?.parent_id != null) await focusTreemap(state.treemapParentNode.parent_id, true);
  }

  async function renderBreadcrumbs(node) {
    const host = $('pathBar');
    if (!host) return;
    if (!node || !state.rootNode) { host.textContent = t('No scan loaded'); return; }
    let items = [node];
    try {
      const event = await makeRequest({ cmd: 'ancestors', node_id: node.id }, 'ancestors');
      if (event.items?.length) items = event.items;
    } catch (_) {}
    const frag = document.createDocumentFragment();
    items.forEach((item, index) => {
      if (index) frag.appendChild(el('span', 'separator', '›'));
      const button = el('button', `crumb${index === items.length - 1 ? ' current' : ''}`, item.name || item.path);
      button.type = 'button'; button.title = item.path || '';
      button.addEventListener('click', () => focusTreemap(item.id, true).catch(reportError));
      frag.appendChild(button);
    });
    host.replaceChildren(frag);
    host.title = node.path || '';
  }

  async function focusSelectedTreemap() {
    const candidate = treemapFocusCandidate();
    if (candidate != null && candidate !== state.treemapParent) await focusTreemap(candidate, true);
  }

  function setTreemapMaximized(maximized) {
    state.treemapMaximized = !!maximized;
    $('workspace').classList.toggle('treemap-maximized', state.treemapMaximized);
    updateTreemapControls();
    // Chromium can expose the previous grid row height for the first animation
    // frame after collapsing/restoring the split view. Draw after layout settles,
    // with a short fallback for DPI/window-manager resize timing.
    requestAnimationFrame(() => requestAnimationFrame(() => drawTreemap()));
    setTimeout(() => drawTreemap(), 80);
  }

  function sameTreemapItem(a, b) {
    if (!a || !b) return false;
    if (a.id != null || b.id != null) return a.id != null && a.id === b.id;
    return a.name === b.name && a.size === b.size && a.extension === b.extension;
  }

  function positionTreemapHoverFrame(item) {
    const frame = $('treemapHoverFrame');
    if (!item) {
      frame.classList.add('hidden');
      return;
    }
    frame.style.left = `${Math.max(0, item.x + 1)}px`;
    frame.style.top = `${Math.max(0, item.y + 1)}px`;
    frame.style.width = `${Math.max(0, item.w - 2)}px`;
    frame.style.height = `${Math.max(0, item.h - 2)}px`;
    frame.classList.remove('hidden');
  }

  function drawCushionedTile(ctx, x, y, w, h, baseColor, enabled, strength) {
    ctx.fillStyle = baseColor;
    ctx.fillRect(x, y, w, h);
    if (!enabled || w < 8 || h < 8 || w * h < 100) return;

    const power = clamp(strength, 0, 100) / 100;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();

    // A layered highlight + edge-darkening treatment gives the rectangles a
    // raised/cushioned appearance while keeping the geometry itself untouched.
    const radius = Math.max(w, h) * 0.72;
    const radial = ctx.createRadialGradient(
      x + w * 0.48, y + h * 0.44, 0,
      x + w * 0.50, y + h * 0.50, Math.max(1, radius),
    );
    radial.addColorStop(0, `rgba(255,255,255,${0.52 * power})`);
    radial.addColorStop(0.28, `rgba(255,255,255,${0.18 * power})`);
    radial.addColorStop(0.62, 'rgba(255,255,255,0)');
    radial.addColorStop(1, `rgba(0,0,0,${0.42 * power})`);
    ctx.fillStyle = radial;
    ctx.fillRect(x, y, w, h);

    const horizontal = ctx.createLinearGradient(x, 0, x + w, 0);
    horizontal.addColorStop(0, `rgba(0,0,0,${0.34 * power})`);
    horizontal.addColorStop(0.18, 'rgba(0,0,0,0)');
    horizontal.addColorStop(0.50, `rgba(255,255,255,${0.10 * power})`);
    horizontal.addColorStop(0.82, 'rgba(0,0,0,0)');
    horizontal.addColorStop(1, `rgba(0,0,0,${0.38 * power})`);
    ctx.fillStyle = horizontal;
    ctx.fillRect(x, y, w, h);

    const vertical = ctx.createLinearGradient(0, y, 0, y + h);
    vertical.addColorStop(0, `rgba(255,255,255,${0.15 * power})`);
    vertical.addColorStop(0.22, 'rgba(255,255,255,0)');
    vertical.addColorStop(0.78, 'rgba(0,0,0,0)');
    vertical.addColorStop(1, `rgba(0,0,0,${0.40 * power})`);
    ctx.fillStyle = vertical;
    ctx.fillRect(x, y, w, h);

    ctx.restore();
  }

  function drawTreemap() {
    const canvas = $('treemapCanvas');
    const wrap = $('treemapWrap');
    const width = Math.max(1, wrap.clientWidth);
    const height = Math.max(1, wrap.clientHeight);
    const dpr = window.devicePixelRatio || 1;
    const pxW = Math.round(width * dpr);
    const pxH = Math.round(height * dpr);
    if (canvas.width !== pxW || canvas.height !== pxH) {
      canvas.width = pxW;
      canvas.height = pxH;
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#090d12';
    ctx.fillRect(0, 0, width, height);
    if (state.treemapMode === 'delta' && state.comparisonResult?.hierarchy?.length) {
      drawDeltaTreemap(ctx, width, height);
      return;
    }
    if (!state.treemapItems.length) {
      state.treemapRects = [];
      state.treemapGroupRects = [];
      state.treemapHover = null;
      $('treemapHoverFrame').classList.add('hidden');
      $('treemapTooltip').classList.add('hidden');
      return;
    }

    const minEdge = clamp(state.settings.treemapMinPx, 1, 20);
    // Preserve the default hierarchy-depth semantics. Auto expands up
    // to three nested directory levels; explicit 1/2/3 values remain expansion
    // depths, and Unlimited is still bounded by the treemap node budget.
    const treemapExpansionDepth = state.settings.treemapDepth === 'unlimited'
      ? 64
      : state.settings.treemapDepth === 'auto'
        ? 3
        : clamp(Number(state.settings.treemapDepth) || 3, 1, 3);
    const hierarchy = window.DiskMosaicTreemap.layoutHierarchy(
      state.treemapItems,
      state.treemapParent,
      width,
      height,
      treemapExpansionDepth,
    );
    const leaves = hierarchy.leaves.map(rect => ({
      ...rect,
      interactive: rect.w >= minEdge && rect.h >= minEdge,
    }));
    const groups = hierarchy.groups;
    state.treemapRects = leaves;
    state.treemapGroupRects = groups;

    const cushionStrength = clamp(state.settings.treemapCushionStrength ?? 78, 0, 100);

    for (const rect of leaves) {
      const isDirectory = rect.kind === 'directory';
      const hasTypeFilter = hasActiveTypeFilter();
      const fallbackMatches = !hasTypeFilter || (rect.kind !== 'aggregate' && (
        state.activeExtensions.includes(rect.extension) ||
        state.activeCategories.includes(categoryForExtension(rect.extension).name)
      ));
      const matchesTypeFilter = rect.matches_filter == null ? fallbackMatches : !!rect.matches_filter;
      const typeFiltered = hasTypeFilter && !matchesTypeFilter;
      const selected = rect.id != null && state.selectedIds.has(rect.id);
      const tiny = !rect.interactive;
      const shortest = Math.min(rect.w, rect.h);
      const edgeInset = shortest >= 6 ? 0.45 : 0;
      const x = rect.x + edgeInset;
      const y = rect.y + edgeInset;
      const w = Math.max(0, rect.w - edgeInset * 2);
      const h = Math.max(0, rect.h - edgeInset * 2);
      if (w <= 0 || h <= 0) continue;

      ctx.globalAlpha = typeFiltered ? 0.11 : 1;
      let baseColor;
      if (tiny) baseColor = '#414a54';
      else if (isDirectory) baseColor = '#53697c';
      else if (rect.kind === 'aggregate') baseColor = '#5b6470';
      else baseColor = treemapColorForItem(rect);

      if (state.settings.treemapVisualization === 'extruded3d') {
        // 3D mode stays visually consistent even for tiny rectangles. The
        // extrusion helper degrades those to a bounded micro-bevel rather than
        // silently switching back to the 2D cushion renderer.
        drawExtrudedTile(ctx, x, y, w, h, baseColor, clamp(state.settings.treemapExtrusionDepth ?? 45, 0, 100));
      } else {
        drawCushionedTile(
          ctx, x, y, w, h, baseColor,
          !tiny && state.settings.treemapCushion,
          cushionStrength,
        );
      }

      if (!tiny && rect.kind === 'aggregate' && w >= 18 && h >= 14) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, y, w, h);
        ctx.clip();
        ctx.strokeStyle = 'rgba(255,255,255,.12)';
        ctx.lineWidth = 1;
        const diagonal = Math.max(w, h);
        for (let offset = -h; offset < w; offset += 11) {
          ctx.beginPath();
          ctx.moveTo(x + offset, y + h);
          ctx.lineTo(x + offset + diagonal, y + h - diagonal);
          ctx.stroke();
        }
        ctx.restore();
      }

      if (!tiny && isDirectory && w >= 18 && h >= 18) {
        ctx.save();
        ctx.strokeStyle = 'rgba(255,255,255,.18)';
        ctx.setLineDash([3, 3]);
        ctx.strokeRect(x + 2.5, y + 2.5, Math.max(0, w - 5), Math.max(0, h - 5));
        ctx.restore();
      }

      ctx.globalAlpha = typeFiltered ? 0.11 : 1;
      if (!tiny && w >= 2 && h >= 2) {
        ctx.strokeStyle = 'rgba(0,0,0,.78)';
        ctx.lineWidth = 1;
        ctx.strokeRect(x + .5, y + .5, Math.max(0, w - 1), Math.max(0, h - 1));
        if (state.settings.treemapCushion && w >= 7 && h >= 7) {
          ctx.strokeStyle = `rgba(255,255,255,${0.20 * cushionStrength / 100})`;
          ctx.beginPath();
          ctx.moveTo(x + 1, y + h - 1);
          ctx.lineTo(x + 1, y + 1);
          ctx.lineTo(x + w - 1, y + 1);
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;

      if (selected) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 3;
        ctx.strokeRect(x + 2, y + 2, Math.max(0, w - 4), Math.max(0, h - 4));
        ctx.strokeStyle = '#0b1118';
        ctx.lineWidth = 1;
        ctx.strokeRect(x + .5, y + .5, Math.max(0, w - 1), Math.max(0, h - 1));
      }

      const labelThreshold = isDirectory ? 48 : 56;
      if ((!isDirectory || state.settings.treemapLabels !== false) && !tiny && w >= labelThreshold && h >= 23) {
        ctx.save();
        ctx.globalAlpha = typeFiltered ? 0.18 : 1;
        // Use nearly the complete tile width. The previous safety margins were
        // large enough to make names ellipsize while visibly unused space still
        // remained on the right side of the tile.
        const labelInset = 3;
        const labelWidth = Math.max(0, w - labelInset * 2);
        ctx.beginPath();
        ctx.rect(x + 1, y + 1, Math.max(0, w - 2), Math.max(0, h - 2));
        ctx.clip();
        ctx.fillStyle = 'rgba(255,255,255,.96)';
        ctx.shadowColor = 'rgba(0,0,0,.78)';
        ctx.shadowBlur = 4;
        const primaryFontPx = w < 96 ? 10 : 11;
        ctx.font = `600 ${primaryFontPx}px "Segoe UI", sans-serif`;
        const primaryLabel = ellipsizeCanvasText(ctx, `${isDirectory ? '▰ ' : ''}${rect.name}`, labelWidth);
        if (primaryLabel) ctx.fillText(primaryLabel, x + labelInset, y + 14);
        if (h >= 39) {
          ctx.fillStyle = 'rgba(255,255,255,.82)';
          const secondaryFontPx = w < 96 ? 9 : 10;
          ctx.font = `${secondaryFontPx}px "Segoe UI", sans-serif`;
          const rootPct = state.rootNode?.size ? (Number(rect.size) / Number(state.rootNode.size)) * 100 : 0;
          const secondaryLabel = ellipsizeCanvasText(ctx, `${formatSize(rect.size)} · ${rootPct.toFixed(rootPct >= 10 ? 1 : 2)}% of scan`, labelWidth);
          if (secondaryLabel) ctx.fillText(secondaryLabel, x + labelInset, y + 28);
        }
        ctx.restore();
      }
    }

    // Directory borders are overlays on the already area-correct child geometry.
    // This exposes hierarchy without stealing pixels from the size representation.
    const orderedGroups = state.settings.treemapBorders === false ? [] : [...groups].filter(group => group.depth < clamp(state.settings.treemapBorderDepth ?? 3, 1, 8)).sort((a, b) => b.depth - a.depth);
    for (const group of orderedGroups) {
      const selected = group.id != null && state.selectedIds.has(group.id);
      const topLevel = group.depth === 0;
      const lineWidth = selected ? 4 : topLevel ? 3 : group.depth === 1 ? 2 : 1;
      const groupFiltered = hasActiveTypeFilter() && group.matches_filter === false;
      ctx.save();
      ctx.globalAlpha = groupFiltered ? 0.12 : 1;
      ctx.strokeStyle = selected
        ? '#ffffff'
        : topLevel
          ? 'rgba(240,247,255,.76)'
          : group.depth === 1
            ? 'rgba(225,237,248,.48)'
            : 'rgba(210,222,235,.28)';
      ctx.lineWidth = lineWidth;
      ctx.shadowColor = topLevel ? 'rgba(0,0,0,.72)' : 'rgba(0,0,0,.48)';
      ctx.shadowBlur = topLevel ? 3 : 1;
      const inset = lineWidth / 2;
      ctx.strokeRect(
        group.x + inset,
        group.y + inset,
        Math.max(0, group.w - lineWidth),
        Math.max(0, group.h - lineWidth),
      );
      ctx.restore();

      if (state.settings.treemapLabels !== false && group.w >= 105 && group.h >= 48 && group.depth <= 3) {
        const label = group.name || 'Directory';
        ctx.save();
        ctx.globalAlpha = groupFiltered ? 0.16 : 1;
        ctx.font = `${topLevel ? '700' : '600'} 11px "Segoe UI", sans-serif`;
        const fullLabel = `▰ ${label}`;
        const availableTextWidth = Math.max(0, group.w - 6);
        const groupLabel = ellipsizeCanvasText(ctx, fullLabel, availableTextWidth);
        const measuredText = groupLabel ? ctx.measureText(groupLabel).width : 0;
        const boxWidth = Math.min(Math.max(0, group.w - 4), measuredText + 6);
        if (groupLabel && boxWidth > 18) {
          // Group captions live at the lower edge so they do not paint over a
          // large child/file caption at the upper-left corner of the same group.
          const labelY = group.y + group.h - 22;
          ctx.fillStyle = topLevel ? 'rgba(8,12,17,.84)' : 'rgba(8,12,17,.70)';
          ctx.fillRect(group.x + 2, labelY, boxWidth, 19);
          ctx.fillStyle = 'rgba(255,255,255,.94)';
          ctx.fillText(groupLabel, group.x + 4, labelY + 13);
        }
        ctx.restore();
      }
    }

    if (state.treemapHover) {
      const refreshedHover = leaves.find(rect => rect.interactive && sameTreemapItem(rect, state.treemapHover)) || null;
      state.treemapHover = refreshedHover;
      positionTreemapHoverFrame(refreshedHover);
      if (!refreshedHover) $('treemapTooltip').classList.add('hidden');
    }
  }

  function drawDeltaTreemap(ctx, width, height) {
    const basisKey = state.sizeBasis === 'allocated' ? 'allocated_delta' : 'logical_delta';
    const source = (state.comparisonResult?.hierarchy || []).map((item, index) => ({
      id: item.current_id ?? null,
      parent_id: state.treemapParent,
      kind: 'delta',
      name: item.name || item.relative_path,
      path: item.relative_path || '',
      status: item.status || 'changed',
      delta: Number(item[basisKey] || 0),
      size: Math.abs(Number(item[basisKey] || 0)),
      extension: '',
      _deltaIndex: index,
    })).filter(item => item.size > 0).slice(0, clamp(state.settings.treemapMaxItems, 100, 10000));
    const minEdge = clamp(state.settings.treemapMinPx, 1, 20);
    const rects = window.DiskMosaicTreemap.layout(source, width, height).map(rect => ({ ...rect, interactive: rect.w >= minEdge && rect.h >= minEdge }));
    state.treemapRects = rects; state.treemapGroupRects = [];
    for (const rect of rects) {
      const growing = rect.delta > 0;
      const shrinking = rect.delta < 0;
      const deltaColor = growing ? '#c74b50' : shrinking ? '#3f78b7' : '#65707c';
      ctx.globalAlpha = rect.interactive ? 0.92 : 0.55;
      if (state.settings.treemapVisualization === 'extruded3d') drawExtrudedTile(ctx, rect.x, rect.y, rect.w, rect.h, deltaColor, clamp(state.settings.treemapExtrusionDepth ?? 45, 0, 100));
      else { ctx.fillStyle = deltaColor; ctx.fillRect(rect.x, rect.y, rect.w, rect.h); }
      ctx.globalAlpha = 1;
      ctx.strokeStyle = 'rgba(0,0,0,.7)'; ctx.lineWidth = 1;
      ctx.strokeRect(rect.x + .5, rect.y + .5, Math.max(0, rect.w - 1), Math.max(0, rect.h - 1));
      if (rect.id != null && state.selectedIds.has(rect.id)) {
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 3;
        ctx.strokeRect(rect.x + 2, rect.y + 2, Math.max(0, rect.w - 4), Math.max(0, rect.h - 4));
      }
      if (state.settings.treemapLabels !== false && rect.w >= 105 && rect.h >= 32) {
        ctx.fillStyle = '#fff'; ctx.font = '600 11px "Segoe UI", sans-serif';
        const sign = rect.delta > 0 ? '+' : rect.delta < 0 ? '−' : '';
        const deltaLabel = ellipsizeCanvasText(ctx, `${rect.name} · ${sign}${formatSize(Math.abs(rect.delta))}`, Math.max(0, rect.w - 12));
        if (deltaLabel) ctx.fillText(deltaLabel, rect.x + 6, rect.y + 16);
      }
    }
    $('treemapCount').textContent = `${integer(rects.length)} ${t('largest changes')} · ${t('area = magnitude of change')}`;
    $('treemapScope').textContent = t('Comparison delta treemap');
    $('treemapScope').title = t('Warm = growth/new data · cool = shrink/deletion · area is absolute change magnitude.');
  }

  function hitTreemap(event) {
    const canvasRect = $('treemapCanvas').getBoundingClientRect();
    const x = event.clientX - canvasRect.left;
    const y = event.clientY - canvasRect.top;
    const item = window.DiskMosaicTreemap.hitTest(state.treemapRects, x, y);
    return item?.interactive ? item : null;
  }

  function showTreemapTooltip(event, item) {
    const tip = $('treemapTooltip');
    const frame = $('treemapHoverFrame');
    state.treemapHover = item;
    if (!item) {
      tip.classList.add('hidden');
      frame.classList.add('hidden');
      return;
    }
    positionTreemapHoverFrame(item);

    const title = el('strong', '', item.name);
    const size = el('div', '', `${formatSize(item.size)} ${state.sizeBasis}`);
    const rootBytes = rootBasisSize();
    const focusBytes = state.treemapParentNode ? basisSize(state.treemapParentNode) : 0;
    const rootPct = rootBytes ? (Number(item.size) / rootBytes) * 100 : 0;
    const focusPct = focusBytes ? (Number(item.size) / focusBytes) * 100 : 0;
    const share = el('div', 'tip-share', `${rootPct.toFixed(rootPct >= 10 ? 1 : 2)}% of full scan${state.treemapParent !== 0 ? ` · ${focusPct.toFixed(focusPct >= 10 ? 1 : 2)}% of focused directory` : ''}`);
    const allocation = item.kind !== 'aggregate'
      ? el('div', 'tip-allocation', `Logical ${formatSize(item.logical_size ?? item.size)} · Allocated ${formatSize(item.allocated_size ?? item.logical_size ?? item.size)}`)
      : null;
    let typeText;
    if (item.kind === 'aggregate') typeText = `${integer(item.aggregated_items)} summarized filesystem object(s)`;
    else if (item.kind === 'directory') typeText = `Directory · ${integer(item.file_count || 0)} files · ${integer(item.dir_count || 0)} subdirectories`;
    else if (item.kind === 'file') {
      const category = categoryForNode(item);
      typeText = `${recognizedExtension(item) ? displayExtension(recognizedExtension(item)) : detectedTypeLabel(item)} · ${category.name}`;
    } else typeText = item.kind;
    const ext = el('div', '', typeText);
    const path = el('div', 'tip-path', item.path);
    tip.replaceChildren(...[title, size, allocation, share, ext, path].filter(Boolean));
    tip.classList.remove('hidden');
    const margin = 14;
    const left = Math.min(window.innerWidth - tip.offsetWidth - margin, event.clientX + 14);
    const top = Math.min(window.innerHeight - tip.offsetHeight - margin, event.clientY + 14);
    tip.style.left = `${Math.max(margin, left)}px`;
    tip.style.top = `${Math.max(margin, top)}px`;
  }

  async function selectTreemapItem(item, clickEvent = null) {
    if (!item) return;
    if (item.kind === 'aggregate') {
      if (item.extension) {
        state.typeMode = 'extension';
        state.activeExtensions = [item.extension];
        state.activeCategories = [];
        renderExtensions();
        refreshTreemapTypeFilter().catch(reportError);
        toast(`Highlighted ${displayExtension(item.extension)} files.`);
      }
      return;
    }
    if (item.id == null) return;
    const additive = !!(clickEvent?.ctrlKey || clickEvent?.metaKey);
    await send(additive ? { cmd: 'selection_toggle', node_id: item.id } : { cmd: 'selection_replace', node_ids: [item.id] });
    const event = await makeRequest({ cmd: 'get_node', node_id: item.id }, 'node');
    if (event.node) await revealNodeInTree(event.node, false);
  }

  function showContextMenu(event, node) {
    event.preventDefault();
    state.contextNode = node;
    const menu = $('contextMenu');
    const rescan = menu.querySelector('[data-action="rescan"]');
    rescan.disabled = node.kind !== 'directory';
    menu.classList.remove('hidden');
    const margin = 8;
    menu.style.left = `${Math.min(event.clientX, window.innerWidth - menu.offsetWidth - margin)}px`;
    menu.style.top = `${Math.min(event.clientY, window.innerHeight - menu.offsetHeight - margin)}px`;
  }

  async function contextAction(action) {
    const node = state.contextNode;
    hideContextMenu();
    if (!node) return;
    if (action === 'open') {
      const result = await api.openPath(node.path);
      if (result) toast(result, true);
    } else if (action === 'reveal') {
      await api.revealPath(node.path);
    } else if (action === 'copy') {
      await api.copyText(node.path);
      toast(t('Path copied.'));
    } else if (action === 'bookmark') {
      const path = node.kind === 'directory' ? node.path : containingDirectory(node.path);
      setBookmark(path, true);
      toast(`Bookmarked: ${path}`);
    } else if (action === 'rescan' && node.kind === 'directory') {
      await send({ cmd: 'refresh_selected', node_ids: [node.id] });
    } else if (action === 'trash') {
      let accepted = true;
      if (state.settings.confirmTrash) {
        accepted = await confirmDialog('Move to Trash?', `Move this item to the operating system Trash/Recycle Bin?\n\n${node.path}`);
      }
      if (accepted) await send({ cmd: 'trash', node_id: node.id });
    }
  }

  function hideContextMenu() { $('contextMenu').classList.add('hidden'); }

  async function collectErrorsForExport() {
    if (!state.errorCount) return { total: 0, stored: 0, items: [] };
    const items = [];
    let total = state.errorCount;
    let stored = 0;
    for (let offset = 0; offset < 10_000; offset += 2000) {
      const event = await makeRequest({ cmd: 'get_errors', offset, limit: 2000 }, 'errors');
      total = event.total || total;
      stored = event.stored || stored;
      items.push(...(event.items || []));
      if (!event.items?.length || items.length >= stored) break;
    }
    return { total, stored, items };
  }

  async function exportReport() {
    if (!state.rootNode || !state.rootPath) return;
    $('exportButton').disabled = true;
    try {
      const [largest, errors] = await Promise.all([
        makeRequest({ cmd: 'largest', limit: 1000 }, 'largest'),
        collectErrorsForExport(),
      ]);
      const report = {
        format: 'DiskMosaic scan report',
        format_version: 1,
        application: { name: 'DiskMosaic', version: '1.0.0', homepage: 'https://github.com/Davoda1/Disk-Mosaic' },
        generated_at: new Date().toISOString(),
        root: state.rootNode,
        summary: state.summary,
        statistics: state.statistics,
        category_statistics: categoryStatistics(),
        extension_statistics: state.extensionStats,
        largest_files: largest.items || [],
        errors,
        scan_parameters: {
          workers: Number(state.settings.workers) || 0,
          follow_symlinks: !!state.settings.followSymlinks,
          cross_filesystems: !!state.settings.crossFilesystems,
          deduplicate_hardlinks: !!state.settings.hardlinks,
          exclude_patterns: String(state.settings.excludePatterns || '').split(/\r?\n/).map(value => value.trim()).filter(Boolean),
        },
      };
      const leaf = (state.rootPath.split(/[\\/]/).filter(Boolean).pop() || 'scan').replace(/[^A-Za-z0-9._-]+/g, '-');
      const date = new Date().toISOString().slice(0, 10);
      const saved = await api.saveTextFile({
        suggestedName: `DiskMosaic-${leaf}-${date}.json`,
        content: JSON.stringify(report, null, 2),
      });
      if (saved) toast(`Report saved: ${saved}`);
    } finally {
      $('exportButton').disabled = !state.rootPath;
    }
  }

  async function showErrors() {
    if (!state.errorCount) return;
    const event = await makeRequest({ cmd: 'get_errors', offset: 0, limit: 2000 }, 'errors');
    $('errorsSummary').textContent = `${integer(event.total)} inaccessible/error entries. Up to ${integer(event.stored)} are retained for inspection; showing ${integer(event.items?.length || 0)}.`;
    const list = $('errorsList');
    const fragment = document.createDocumentFragment();
    for (const item of event.items || []) {
      const row = el('div', 'error-row');
      row.append(el('span', '', item.path), el('span', '', item.message));
      fragment.appendChild(row);
    }
    list.replaceChildren(fragment);
    $('errorsModal').classList.remove('hidden');
  }

  function refreshLocalizedUi() {
    updateSizeBasisButtons();
    updateTreemapControls();
    updateScanSummaryStrip();
    updateDetails(state.selectedNode);
    renderSavedLocations();
    renderExtensions();
    renderStatistics();
    treeList.refresh();
    largestList.refresh();
    searchList.refresh();
    duplicateList.refresh();
    compareList.refresh();
    const activeView = document.querySelector('.tab.active')?.dataset.view || 'directory';
    setActiveView(activeView);
  }


  function setSettingsSection(section) {
    const valid = [...document.querySelectorAll('#settingsNav [data-settings-section]')].map(b=>b.dataset.settingsSection);
    state.activeSettingsSection = valid.includes(section) ? section : 'general';
    document.querySelectorAll('#settingsNav [data-settings-section]').forEach(button=>button.classList.toggle('active',button.dataset.settingsSection===state.activeSettingsSection));
    document.querySelectorAll('.settings-grid > fieldset[data-settings-section]').forEach(fieldset=>fieldset.classList.toggle('settings-section-active',fieldset.dataset.settingsSection===state.activeSettingsSection));
    document.querySelector('.settings-grid').scrollTop = 0;
    requestAnimationFrame(() => {
      const nav = $('settingsNav'), active = nav.querySelector('.active');
      if (!active) return;
      const n = nav.getBoundingClientRect(), b = active.getBoundingClientRect();
      if (b.top < n.top) nav.scrollTop -= n.top - b.top + 6;
      else if (b.bottom > n.bottom) nav.scrollTop += b.bottom - n.bottom + 6;
    });
    state.settings.settingsSection=state.activeSettingsSection;
    persistWorkspaceState();
  }

  function renderFileTypeRegistry(filter='') {
    const host=$('fileTypeRegistryList'); if(!host)return; const q=String(filter).trim().toLowerCase(); host.replaceChildren();
    const rows=[]; for(const [category,extensions] of Object.entries(fileTypes?.categoryExtensions||{})){const filtered=(extensions||[]).filter(ext=>!q||category.toLowerCase().includes(q)||ext.toLowerCase().includes(q));if(filtered.length)rows.push({category,extensions:filtered});}
    rows.sort((a,b)=>a.category.localeCompare(b.category));
    for(const row of rows.slice(0,120)){const details=document.createElement('details');const summary=document.createElement('summary');summary.textContent=`${row.category} · ${integer(row.extensions.length)} mappings`;details.appendChild(summary);details.appendChild(el('p','registry-extensions',row.extensions.slice(0,240).join(' ')));host.appendChild(details);}
    const custom=String(state.settings?.fileTypeOverrides||'').split(/\r?\n/).map(line=>line.trim()).filter(line=>line&&!line.startsWith('#'));
    if(custom.length){const details=document.createElement('details');details.open=!!q;details.appendChild(el('summary','',`${t('Custom extension overrides')} · ${integer(custom.length)}`));details.appendChild(el('p','registry-extensions',custom.join('  ·  ')));host.prepend(details);}
  }

  async function loadHistoryMaintenanceStatus(){const event=await makeRequest({cmd:'history_maintenance_status'},'history_maintenance',30000);const r=event.result||{};$('historyMaintenanceStatus').textContent=`Schema ${r.schema_version??'—'} · ${integer(r.scans||0)} scans · DB ${formatSize(r.database_bytes||0)} · ${integer(r.fingerprint_entries||0)} fingerprints · integrity ${r.integrity||'unknown'}`;}
  function retentionRequest(mode, keepLast, keepMonths) {
    const normalized = ['last','months','custom'].includes(mode) ? mode : 'all';
    if (normalized === 'last') return { keep_last_per_root: clamp(Number(keepLast)||100,1,100000) };
    if (normalized === 'months') return { keep_months: clamp(Number(keepMonths)||24,1,1200) };
    if (normalized === 'custom') return { keep_last_per_root: clamp(Number(keepLast)||100,1,100000), keep_months: clamp(Number(keepMonths)||24,1,1200) };
    return {};
  }

  async function historyMaintenance(action){
    if(action==='integrity'){const e=await makeRequest({cmd:'history_integrity'},'history_maintenance',30000);toast(`${t('History integrity')}: ${e.result?.integrity||'unknown'}`);return loadHistoryMaintenanceStatus();}
    if(action==='optimize'){if(!window.confirm(t('Optimize/VACUUM the local history database? This changes only DiskMosaic history storage.')))return;await makeRequest({cmd:'history_optimize'},'history_maintenance',120000);toast(t('History database optimized.'));return loadHistoryMaintenanceStatus();}
    if(action==='backup'){const path=await api.saveDatabasePath?.();if(!path)return;await makeRequest({cmd:'history_backup',path},'history_maintenance',120000);toast(t('History database backup created.'));return;}
    if(action==='prune'){if(!window.confirm(t('Prune fingerprint cache entries older than 180 days? Scan history and filesystem content are not deleted.')))return;const cutoff=Date.now()-180*86400000;const e=await makeRequest({cmd:'history_prune_fingerprints',older_than_ms:cutoff},'history_maintenance',60000);toast(`${integer(e.result?.deleted||0)} ${t('fingerprint cache entries pruned')}`);return loadHistoryMaintenanceStatus();}
    if(action==='retention'){const mode=$('settingHistoryRetentionMode').value||'all';if(mode==='all'){toast(t('Retention policy is Keep all scans; no history was deleted.'));return;}if(!window.confirm(t('Apply the configured history retention now? This deletes only DiskMosaic history snapshots, never filesystem content.')))return;const e=await makeRequest({cmd:'history_apply_retention',...retentionRequest(mode,$('settingHistoryKeepLast').value,$('settingHistoryKeepMonths').value)},'history_maintenance',120000);toast(`${integer(e.result?.deleted||0)} ${t('history snapshots deleted')}`);await loadHistory();return loadHistoryMaintenanceStatus();}
  }

  function openSettings() {
    const s = state.settings;
    $('settingLanguage').value = s.language || 'en';
    $('settingTheme').value = s.theme;
    $('settingUnits').value = s.units;
    $('settingSizeBasis').value = s.sizeBasis || 'logical';
    $('settingDuplicateMinSize').value = s.duplicateMinSize || '1 MiB';
    $('settingConfirmTrash').checked = s.confirmTrash;
    $('settingHiddenDisplayMode').value = hiddenDisplayMode();
    $('settingWorkers').value = s.workers;
    $('settingFollowSymlinks').checked = s.followSymlinks;
    $('settingCrossFilesystems').checked = s.crossFilesystems;
    $('settingHardlinks').checked = s.hardlinks;
    $('settingWatchFilesystem').checked = s.watchFilesystem === true;
    $('settingWatchDebounce').value = String(s.watchDebounce || 500);
    const cols = { ...defaultSettings.treeColumns, ...(s.treeColumns || {}) };
    $('settingColumnLogical').checked = cols.logical !== false;
    $('settingColumnAllocated').checked = cols.allocated !== false;
    $('settingColumnShare').checked = cols.share !== false;
    $('settingColumnFiles').checked = cols.files !== false;
    $('settingColumnDirectories').checked = cols.directories !== false;
    $('settingColumnModified').checked = cols.modified !== false;
    $('settingColumnOwner').checked = cols.owner !== false;
    $('settingColumnPermissions').checked = cols.permissions !== false;
    $('settingExcludePatterns').value = s.excludePatterns || '';
    $('settingCategoryRules').value = s.categoryRules || '';
    $('settingTreemapMinPx').value = s.treemapMinPx;
    $('settingTreemapMaxItems').value = s.treemapMaxItems;
    $('settingTreemapCushion').checked = s.treemapCushion !== false;
    $('settingTreemapColorMode').value = s.treemapColorMode || 'category';
    $('settingTreemapCushionStrength').value = clamp(s.treemapCushionStrength ?? 78, 0, 100);
    $('settingTreemapDepth').value = s.treemapDepth || 'auto';
    $('settingTreemapLabels').checked = s.treemapLabels !== false;
    $('settingTreemapBorders').checked = s.treemapBorders !== false;
    $('settingTreemapBorderDepth').value = clamp(s.treemapBorderDepth ?? 3, 1, 8);
    $('settingAnimation').checked = s.animation;
    $('settingTreemapVisualization').value = s.treemapVisualization || 'cushioned2d';
    $('settingTreemapExtrusionDepth').value = clamp(s.treemapExtrusionDepth ?? 45, 0, 100);
    $('settingAlternatingRows').checked = s.alternatingRows === true;
    $('settingReducedMotion').checked = s.reducedMotion === true;
    $('settingHighContrastFocus').checked = s.highContrastFocus === true;
    $('settingFileTypeOverrides').value = s.fileTypeOverrides || '';
    $('settingHistoryAutoRetention').checked = s.historyAutoRetention === true;
    $('settingHistoryRetentionMode').value = s.historyRetentionMode || 'all';
    $('settingHistoryKeepLast').value = clamp(s.historyKeepLast ?? 100, 1, 100000);
    $('settingHistoryKeepMonths').value = clamp(s.historyKeepMonths ?? 24, 1, 1200);
    $('settingDuplicateMinSizeMirror').value = s.duplicateMinSize || '1 MiB';
    $('settingTreeShareBandColorsEnabled').checked = s.treeShareBandColorsEnabled === true;
    const shareColors = normalizeTreeShareBandColors(s.treeShareBandColors);
    const shareMaxima = normalizeTreeShareBandMaxima(s.treeShareBandMaxima);
    for (let index = 0; index < TREE_SHARE_BAND_COUNT; index += 1) {
      $(`settingTreeShareColor${index + 1}`).value = shareColors[index];
      $(`settingTreeShareMax${index + 1}`).value = shareMaxima[index];
    }
    setSettingsSection(s.settingsSection || state.activeSettingsSection || 'general');
    renderFileTypeRegistry();
    loadHistoryMaintenanceStatus().catch(()=>{});
    $('settingsModal').classList.remove('hidden');
  }

  function saveSettingsFromDialog() {
    const treeShareBandColors = Array.from({ length: TREE_SHARE_BAND_COUNT }, (_, index) => $(`settingTreeShareColor${index + 1}`).value);
    const treeShareBandMaxima = Array.from({ length: TREE_SHARE_BAND_COUNT }, (_, index) => Number($(`settingTreeShareMax${index + 1}`).value));
    const validMaxima = treeShareBandMaxima.every((number, index) => Number.isFinite(number) && number >= 0 && number <= 100 && (index === 0 || number > treeShareBandMaxima[index - 1]));
    if (!validMaxima || treeShareBandMaxima[TREE_SHARE_BAND_COUNT - 1] !== 100) {
      toast(t('Tree share-bar bands require exactly four strictly increasing upper limits from 0–100%, with the fourth fixed at 100%.'), true);
      return;
    }
    if (treeShareBandColors.some(color => !/^#[0-9a-f]{6}$/i.test(String(color || '')))) {
      toast(t('Tree share-bar bands require exactly four valid colors.'), true);
      return;
    }
    saveSettings({
      ...state.settings,
      language: $('settingLanguage').value,
      theme: $('settingTheme').value,
      units: $('settingUnits').value,
      sizeBasis: $('settingSizeBasis').value === 'allocated' ? 'allocated' : 'logical',
      duplicateMinSize: ($('settingDuplicateMinSizeMirror').value.trim() || $('settingDuplicateMinSize').value.trim() || '1 MiB'),
      confirmTrash: $('settingConfirmTrash').checked,
      hiddenDisplayMode: ['directories_only','hide_all'].includes($('settingHiddenDisplayMode').value) ? $('settingHiddenDisplayMode').value : 'show_all',
      workers: clamp(Number($('settingWorkers').value) || 0, 0, 64),
      followSymlinks: $('settingFollowSymlinks').checked,
      crossFilesystems: $('settingCrossFilesystems').checked,
      hardlinks: $('settingHardlinks').checked,
      watchFilesystem: $('settingWatchFilesystem').checked,
      watchDebounce: clamp(Number($('settingWatchDebounce').value) || 500, 100, 60000),
      treeColumns: {
        logical: $('settingColumnLogical').checked, allocated: $('settingColumnAllocated').checked,
        share: $('settingColumnShare').checked, files: $('settingColumnFiles').checked,
        directories: $('settingColumnDirectories').checked, modified: $('settingColumnModified').checked,
        owner: $('settingColumnOwner').checked, permissions: $('settingColumnPermissions').checked,
      },
      excludePatterns: $('settingExcludePatterns').value,
      categoryRules: $('settingCategoryRules').value,
      treemapColorMode: $('settingTreemapColorMode').value,
      treemapMinPx: clamp(Number($('settingTreemapMinPx').value) || 4, 1, 20),
      treemapMaxItems: clamp(Number($('settingTreemapMaxItems').value) || 2200, 100, 10000),
      treemapCushion: $('settingTreemapCushion').checked,
      treemapCushionStrength: clamp(Number($('settingTreemapCushionStrength').value) || 0, 0, 100),
      treemapDepth: $('settingTreemapDepth').value || 'auto',
      treemapLabels: $('settingTreemapLabels').checked,
      treemapBorders: $('settingTreemapBorders').checked,
      treemapBorderDepth: clamp(Number($('settingTreemapBorderDepth').value) || 3, 1, 8),
      treeShareBandColorsEnabled: $('settingTreeShareBandColorsEnabled').checked,
      treeShareBandColors,
      treeShareBandMaxima,
      treemapVisualization: $('settingTreemapVisualization').value === 'extruded3d' ? 'extruded3d' : 'cushioned2d',
      treemapExtrusionDepth: clamp(Number($('settingTreemapExtrusionDepth').value) || 0, 0, 100),
      alternatingRows: $('settingAlternatingRows').checked,
      reducedMotion: $('settingReducedMotion').checked,
      highContrastFocus: $('settingHighContrastFocus').checked,
      fileTypeOverrides: $('settingFileTypeOverrides').value,
      historyAutoRetention: $('settingHistoryAutoRetention').checked,
      historyRetentionMode: $('settingHistoryRetentionMode').value || 'all',
      historyKeepLast: clamp(Number($('settingHistoryKeepLast').value)||100,1,100000),
      historyKeepMonths: clamp(Number($('settingHistoryKeepMonths').value)||24,1,1200),
      settingsSection: state.activeSettingsSection,
      visualizerRevision: defaultSettings.visualizerRevision,
      animation: $('settingAnimation').checked,
    });
    $('settingsModal').classList.add('hidden');
    refreshLocalizedUi();
    categoryCacheKey = null;
    const categoryWarnings = buildCategoryModel().warnings;
    if (categoryWarnings.length) toast(`${categoryWarnings.length} category rule(s) were ignored; check their syntax.`, true);
    $('duplicateMinSize').value = state.settings.duplicateMinSize || '1 MiB';
    renderExtensions();
    if (state.rootNode) {
      reloadTree().catch(reportError);
      focusTreemap(state.treemapParent, false).catch(reportError);
      const activeView = document.querySelector('.tab.active')?.dataset.view;
      if (activeView === 'largest') loadLargest().catch(reportError);
      if (activeView === 'search') runSearch().catch(reportError);
    }
    if (state.rootNode && !state.snapshotPath) {
      if (state.settings.watchFilesystem) startWatcher().catch(reportError);
      else send({ cmd: 'watch_stop' }).catch(() => {});
    }
  }

  function confirmDialog(title, text) {
    $('confirmTitle').textContent = title;
    $('confirmText').textContent = text;
    $('confirmModal').classList.remove('hidden');
    return new Promise(resolve => {
      const cleanup = value => {
        $('confirmModal').classList.add('hidden');
        $('confirmAccept').removeEventListener('click', accept);
        $('confirmCancel').removeEventListener('click', cancel);
        resolve(value);
      };
      const accept = () => cleanup(true);
      const cancel = () => cleanup(false);
      $('confirmAccept').addEventListener('click', accept);
      $('confirmCancel').addEventListener('click', cancel);
    });
  }

  function askCollectionName(title, initialValue = '') {
    const modal = $('collectionNameModal');
    if (!modal.classList.contains('hidden')) return Promise.resolve(null);
    const form = $('collectionNameForm');
    const input = $('collectionNameInput');
    const cancelButton = $('collectionNameCancel');
    const saveButton = $('collectionNameSave');
    const previousFocus = document.activeElement;
    $('collectionNameTitle').textContent = title;
    input.value = String(initialValue).slice(0,120);
    saveButton.disabled = !input.value.trim();
    modal.classList.remove('hidden');
    input.focus();
    input.select();
    return new Promise(resolve => {
      const finish = value => {
        modal.classList.add('hidden');
        form.removeEventListener('submit', submit);
        modal.removeEventListener('keydown', keydown);
        input.removeEventListener('input', update);
        cancelButton.removeEventListener('click', cancel);
        previousFocus?.focus();
        resolve(value);
      };
      const submit = event => {
        event.preventDefault();
        const value = input.value.trim().slice(0,120);
        if (value) finish(value);
      };
      const cancel = () => finish(null);
      const update = () => { saveButton.disabled = !input.value.trim(); };
      const keydown = event => {
        event.stopPropagation();
        if (event.key === 'Escape') { event.preventDefault(); cancel(); }
        if (event.key === 'Tab') {
          const last = saveButton.disabled ? cancelButton : saveButton;
          if (event.shiftKey && document.activeElement === input) { event.preventDefault(); last.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); input.focus(); }
        }
      };
      form.addEventListener('submit', submit);
      modal.addEventListener('keydown', keydown);
      input.addEventListener('input', update);
      cancelButton.addEventListener('click', cancel);
    });
  }

  let tabPageStart = 0;
  let tabPageEnd = 0;
  function layoutWorkspaceTabs(revealActive = false) {
    const strip = document.querySelector('.panel-tabs');
    const tabs = [...strip.querySelectorAll('.tab')];
    const previous = $('previousTabsButton'), next = $('nextTabsButton');
    // Measure natural translated widths, before deciding which whole tabs fit.
    tabs.forEach(tab => tab.classList.remove('tab-page-hidden'));
    previous.hidden = next.hidden = true;
    const widths = tabs.map(tab => Math.ceil(tab.getBoundingClientRect().width));
    const overflow = widths.reduce((a, b) => a + b, 0) > strip.clientWidth;
    previous.hidden = next.hidden = !overflow;
    const anchor = revealActive ? tabs.findIndex(tab => tab.classList.contains('active')) : null;
    const page = overflow ? window.DiskMosaicLayout.tabPage(widths, strip.clientWidth, tabPageStart, anchor)
      : { start: 0, end: tabs.length };
    tabPageStart = page.start; tabPageEnd = page.end;
    tabs.forEach((tab, index) => {
      tab.classList.toggle('tab-page-hidden', index < page.start || index >= page.end);
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', String(tab.classList.contains('active')));
      tab.setAttribute('aria-controls', `${tab.dataset.view}View`);
    });
    previous.disabled = page.start === 0;
    next.disabled = page.end === tabs.length;
    strip.scrollLeft = 0;
  }
  function ensureActiveTabVisible() {
    requestAnimationFrame(() => layoutWorkspaceTabs(true));
  }

  function setupLayoutContainers() {
    $('previousTabsButton').addEventListener('click', () => {
      tabPageStart = Math.max(0, tabPageStart - 1); layoutWorkspaceTabs();
    });
    $('nextTabsButton').addEventListener('click', () => {
      tabPageStart = tabPageEnd; layoutWorkspaceTabs();
    });
    document.querySelector('.panel-tabs').addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      const tabs = [...document.querySelectorAll('.panel-tabs .tab')];
      const current = tabs.indexOf(document.activeElement);
      if (current < 0) return;
      event.preventDefault();
      const index = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
        : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      setActiveView(tabs[index].dataset.view);
      layoutWorkspaceTabs(true); tabs[index].focus();
    });
    new ResizeObserver(() => layoutWorkspaceTabs(true)).observe(document.querySelector('.tab-navigation'));
    for (const table of document.querySelectorAll('.table-viewport')) {
      const list = table.lastElementChild;
      const syncGutter = () => table.style.setProperty('--table-scrollbar', `${list.offsetWidth - list.clientWidth}px`);
      new ResizeObserver(syncGutter).observe(list);
      syncGutter();
    }
    layoutWorkspaceTabs(true);
  }

  function setActiveView(view) {
    document.querySelectorAll('.tab').forEach(tab => tab.classList.toggle('active', tab.dataset.view === view));
    document.querySelectorAll('.view').forEach(panel => panel.classList.toggle('active', panel.id === `${view}View`));
    ensureActiveTabVisible();
    const context = VIEW_CONTEXT[view] || VIEW_CONTEXT.directory;
    $('viewContextTitle').textContent = t(context[0]);
    $('viewContextText').textContent = t(context[1]);
    $('viewContextMeta').textContent = context[2];
    if (view === 'largest') loadLargest().catch(reportError);
    if (view === 'duplicates') { renderDuplicateSummary(); duplicateList.refresh(); }
    if (view === 'compare') { renderComparisonSummary(); compareList.refresh(); }
    if (view === 'statistics') renderStatistics();
    if (view === 'history') { loadHistory().catch(reportError); loadHistoryExplorer().catch(reportError); }
    if (view === 'age' && state.rootNode && !state.ageAnalysis) runAgeAnalysis().catch(reportError);
    if (view === 'cleanup' && state.rootNode && !state.cleanupRows.length) runCleanupAnalysis().catch(reportError);
    if (view === 'allocation' && state.rootNode) runAllocationAnalysis().catch(reportError);
    if (view === 'issues' && state.rootNode) loadIssuesCenter().catch(reportError);
    if (view === 'diagnostics') loadDiagnostics().catch(reportError);
    if (view === 'reports') $('reportPreviewSummary').textContent = state.rootNode ? `${formatSize(state.summary?.bytes||0)} logical · ${integer(state.summary?.files||0)} files · self-contained offline export ready` : t('Load a scan before exporting a report.');
    persistWorkspaceState();
  }

  function setupSplitters() {
    const vertical = $('verticalSplitter');
    vertical.addEventListener('pointerdown', event => {
      event.preventDefault();
      vertical.setPointerCapture(event.pointerId);
      vertical.classList.add('dragging');
      const move = e => {
        const rect = $('upperPane').getBoundingClientRect();
        const pct = ((e.clientX - rect.left) / rect.width) * 100;
        state.settings.treeWidth = clamp(pct, 50, 78);
        document.documentElement.style.setProperty('--tree-width', `${state.settings.treeWidth}%`);
      };
      const up = () => {
        vertical.classList.remove('dragging');
        vertical.removeEventListener('pointermove', move);
        vertical.removeEventListener('pointerup', up);
        saveSettings(state.settings);
      };
      vertical.addEventListener('pointermove', move);
      vertical.addEventListener('pointerup', up);
    });

    const horizontal = $('horizontalSplitter');
    horizontal.addEventListener('pointerdown', event => {
      event.preventDefault();
      horizontal.setPointerCapture(event.pointerId);
      horizontal.classList.add('dragging');
      const move = e => {
        const rect = $('workspace').getBoundingClientRect();
        const pct = ((e.clientY - rect.top) / rect.height) * 100;
        state.settings.topHeight = clamp(pct, 30, 75);
        document.documentElement.style.setProperty('--top-height', `${state.settings.topHeight}%`);
      };
      const up = () => {
        horizontal.classList.remove('dragging');
        horizontal.removeEventListener('pointermove', move);
        horizontal.removeEventListener('pointerup', up);
        saveSettings(state.settings);
      };
      horizontal.addEventListener('pointermove', move);
      horizontal.addEventListener('pointerup', up);
    });
  }

  function openAbout() {
    // About is subordinate to Settings. Keep Settings open underneath so closing
    // About returns the user to exactly the settings state they came from.
    $('aboutModal').classList.remove('hidden');
    $('closeAboutButton').focus();
  }

  function closeAbout() {
    $('aboutModal').classList.add('hidden');
    if (!$('settingsModal').classList.contains('hidden')) $('aboutButton').focus();
  }

  const commandPaletteCommands = [
    ['Scan folder…', () => chooseFolderAndScan()],
    ['Save scan…', () => saveSnapshot()],
    ['Open scan…', () => openSnapshot()],
    ['Refresh selected directory', () => send({ cmd: 'refresh_selected' })],
    ['Enable/disable watching', () => state.watcherState === 'watching' || state.watcherState === 'paused' ? send({ cmd: 'watch_stop' }) : startWatcher()],
    ['Compare with…', () => compareWithSnapshot()],
    ['Find duplicates', () => { setActiveView('duplicates'); return startDuplicateAnalysis(); }],
    ['Focus selected', () => focusSelectedTreemap()],
    ['Go to root', () => focusTreemapRoot()],
    ['Change size basis', () => setSizeBasis(state.sizeBasis === 'logical' ? 'allocated' : 'logical')],
    ['Maximize treemap', () => setTreemapMaximized(!state.treemapMaximized)],
    ['Export report', () => exportReport()],
    ['History', () => setActiveView('history')],
    ['Settings', () => openSettings()],
    ['Clear type filter', () => { state.activeExtensions = []; state.activeCategories = []; renderExtensions(); return refreshTreemapTypeFilter(); }],
  ];

  function openCommandPalette() {
    $('commandPaletteModal').classList.remove('hidden');
    $('commandPaletteInput').value = '';
    renderCommandPalette('');
    requestAnimationFrame(() => $('commandPaletteInput').focus());
  }

  function renderCommandPalette(query) {
    const host = $('commandPaletteList');
    const needle = String(query || '').trim().toLocaleLowerCase(i18n?.locale?.());
    const commands = commandPaletteCommands.filter(([label]) => !needle || t(label).toLocaleLowerCase(i18n?.locale?.()).includes(needle));
    const frag = document.createDocumentFragment();
    for (const [label, action] of commands) {
      const button = el('button', '', t(label)); button.type = 'button';
      button.addEventListener('click', () => {
        $('commandPaletteModal').classList.add('hidden');
        Promise.resolve(action()).catch(reportError);
      });
      frag.appendChild(button);
    }
    if (!commands.length) frag.appendChild(el('div', 'muted', t('No matching commands.')));
    host.replaceChildren(frag);
  }

  function showSelectionMenu() {
    if (!state.selectionSummary?.selected_items) return;
    const menu = $('selectionMenu');
    const button = $('selectionActionsButton');
    const rect = button.getBoundingClientRect();
    menu.classList.remove('hidden');
    const margin = 8;
    menu.style.left = `${Math.min(rect.left, window.innerWidth - menu.offsetWidth - margin)}px`;
    menu.style.top = `${Math.min(rect.bottom + 4, window.innerHeight - menu.offsetHeight - margin)}px`;
  }

  async function fetchSelectionItems(limit = 50000) {
    const items = [];
    for (let offset = 0; offset < limit; offset += 5000) {
      const event = await makeRequest({ cmd: 'selection_page', offset, limit: Math.min(5000, limit - offset) }, 'selection_page', 30000);
      items.push(...(event.items || []));
      if (!event.items?.length || items.length >= Number(event.total || 0)) break;
    }
    return items;
  }

  async function selectionAction(action) {
    $('selectionMenu').classList.add('hidden');
    if (!state.selectionSummary?.selected_items && action !== 'clear') return;
    if (action === 'clear') { await send({ cmd: 'selection_clear' }); selectNode(null, false); return; }
    if (action === 'refresh') { await send({ cmd: 'refresh_selected' }); return; }
    if (action === 'hash') { state.analyzing = true; await send({ cmd: 'hash_selection', max_files: 5000 }); return; }
    if (action === 'trash') {
      if (state.snapshotPath) { toast(t('Filesystem actions are disabled for saved/history scans.'), true); return; }
      const summary = state.selectionSummary;
      const total = state.sizeBasis === 'allocated' ? summary.allocated_size : summary.logical_size;
      const accepted = await confirmDialog(
        t('Move selected items to Trash?'),
        t('{count} selected items ({size}) will be moved to the operating system Trash/Recycle Bin. Individual failures will be reported; no permanent deletion is performed.', { count: integer(summary.selected_items), size: formatSize(total) }),
      );
      if (accepted) { state.analyzing = true; await send({ cmd: 'batch_trash' }); }
      return;
    }
    const items = await fetchSelectionItems();
    if (!items.length) return;
    if (action === 'copy-paths') { await api.copyText(items.map(item => item.path).join('\n')); toast(t('Paths copied.')); }
    else if (action === 'copy-names') { await api.copyText(items.map(item => item.name).join('\n')); toast(t('Filenames copied.')); }
    else if (action === 'reveal') {
      if (items.length !== 1) { toast(t('Open containing folder is available for a single selected item.'), true); return; }
      await api.revealPath(items[0].path);
    } else if (action === 'export') {
      const content = JSON.stringify({ format: 'DiskMosaic selected items', version: 1, generated_at: new Date().toISOString(), truncated: items.length >= 50000, items }, null, 2);
      const saved = await api.saveTextFile({ suggestedName: `DiskMosaic-selected-${new Date().toISOString().slice(0, 10)}.json`, content });
      if (saved) toast(t('Selected-item list saved.'));
    }
  }

  function proposeDuplicateSelection(strategy) {
    const ids = [];
    for (const group of state.duplicateResult?.groups || []) {
      const items = [...(group.items || [])];
      if (items.length < 2) continue;
      let keep = items[0];
      if (strategy === 'newest') keep = items.reduce((a, b) => Number(b.modified_ms || 0) > Number(a.modified_ms || 0) ? b : a);
      else if (strategy === 'oldest') keep = items.reduce((a, b) => Number(b.modified_ms || Infinity) < Number(a.modified_ms || Infinity) ? b : a);
      else if (strategy === 'shortest') keep = items.reduce((a, b) => String(b.path).length < String(a.path).length ? b : a);
      else if (strategy === 'selected') keep = items.find(item => state.selectedNode?.id === item.id || state.selectedIds.has(item.id)) || keep;
      for (const item of items) if (item.id !== keep.id) ids.push(item.id);
    }
    send({ cmd: 'selection_replace', node_ids: ids.slice(0, 100000) }).catch(reportError);
    toast(t('Proposed duplicate selection updated; nothing was deleted.'));
  }

  function setupEvents() {
    $('scanButton').addEventListener('click', async () => {
      $('startOverlay').classList.remove('hidden');
      await loadRoots();
    });
    $('overlayFolderButton').addEventListener('click', () => chooseFolderAndScan().catch(reportError));
    $('overlaySettingsButton').addEventListener('click', openSettings);
    $('overlaySnapshotButton').addEventListener('click', () => openSnapshot().catch(reportError));
    $('overlayHistoryButton').addEventListener('click', () => { $('startOverlay').classList.add('hidden'); setActiveView('history'); loadHistoryExplorer().catch(reportError); });
    $('openSnapshotButton').addEventListener('click', () => openSnapshot().catch(reportError));
    $('saveSnapshotButton').addEventListener('click', () => saveSnapshot().catch(reportError));
    $('rescanButton').addEventListener('click', () => state.rootPath && startScan(state.rootPath).catch(reportError));
    $('cancelButton').addEventListener('click', async () => {
      $('cancelButton').disabled = true;
      await send({ cmd: 'cancel' });
    });
    $('pauseButton').addEventListener('click', async () => {
      if (!state.scanning) return;
      $('pauseButton').disabled = true;
      await send({ cmd: state.scanPaused ? 'resume' : 'pause' });
      $('pauseButton').disabled = false;
    });
    $('logicalBasisButton').addEventListener('click', () => setSizeBasis('logical').catch(reportError));
    $('allocatedBasisButton').addEventListener('click', () => setSizeBasis('allocated').catch(reportError));
    $('duplicateAnalyzeButton').addEventListener('click', () => startDuplicateAnalysis().catch(reportError));
    $('duplicateCancelButton').addEventListener('click', () => send({ cmd: 'cancel_analysis' }).catch(reportError));
    $('compareSnapshotButton').addEventListener('click', () => compareWithSnapshot().catch(reportError));
    $('backButton').addEventListener('click', () => navigateBack().catch(reportError));
    $('forwardButton').addEventListener('click', () => navigateForward().catch(reportError));
    $('parentButton').addEventListener('click', () => navigateParent().catch(reportError));
    $('treemapRootButton').addEventListener('click', () => focusTreemapRoot().catch(reportError));
    $('treemapFocusButton').addEventListener('click', () => focusSelectedTreemap().catch(reportError));
    $('treemapModeButton').addEventListener('click', () => {
      if (!state.comparisonResult) return;
      state.treemapMode = state.treemapMode === 'delta' ? 'current' : 'delta';
      updateTreemapControls();
      if (state.treemapMode === 'current') {
        focusTreemap(state.treemapParentNode?.id ?? state.treemapParent ?? 0, false).catch(reportError);
      } else {
        drawTreemap();
      }
    });
    $('treemapExpandButton').addEventListener('click', () => setTreemapMaximized(!state.treemapMaximized));
    $('treemapLegendButton').addEventListener('click', () => { const legend=$('treemapLegend'); const hidden=legend.classList.toggle('hidden'); $('treemapLegendButton').setAttribute('aria-expanded',String(!hidden)); });
    $('settingsButton').addEventListener('click', openSettings);
    document.querySelectorAll('#settingsNav [data-settings-section]').forEach(button=>button.addEventListener('click',()=>setSettingsSection(button.dataset.settingsSection)));
    $('fileTypeSearch').addEventListener('input',event=>renderFileTypeRegistry(event.target.value));
    $('resetFileTypeOverridesButton').addEventListener('click',()=>{ $('settingFileTypeOverrides').value='';renderFileTypeRegistry($('fileTypeSearch').value); });
    $('historyIntegrityButton').addEventListener('click',()=>historyMaintenance('integrity').catch(reportError));
    $('historyOptimizeButton').addEventListener('click',()=>historyMaintenance('optimize').catch(reportError));
    $('historyBackupButton').addEventListener('click',()=>historyMaintenance('backup').catch(reportError));
    $('historyPruneButton').addEventListener('click',()=>historyMaintenance('prune').catch(reportError));
    $('historyApplyRetentionButton').addEventListener('click',()=>historyMaintenance('retention').catch(reportError));
    $('openDiagnosticsFromSettings').addEventListener('click',()=>{ $('settingsModal').classList.add('hidden');setActiveView('diagnostics');loadDiagnostics().catch(reportError); });
    $('bookmarkButton').addEventListener('click', () => state.rootPath && setBookmark(state.rootPath, !isBookmarked(state.rootPath)));
    $('exportButton').addEventListener('click', () => exportReport().catch(reportError));
    $('saveSettingsButton').addEventListener('click', saveSettingsFromDialog);
    $('aboutButton').addEventListener('click', openAbout);
    $('closeAboutButton').addEventListener('click', closeAbout);
    $('resetTreeColumnsButton').addEventListener('click', () => {
      for (const id of ['settingColumnLogical','settingColumnAllocated','settingColumnShare','settingColumnFiles','settingColumnDirectories','settingColumnModified']) $(id).checked = true;
      $('settingColumnOwner').checked = false; $('settingColumnPermissions').checked = false;
      state.settings.treeColumnOrder = [...defaultSettings.treeColumnOrder];
      state.settings.treeColumnWidths = { ...defaultSettings.treeColumnWidths };
    });
    document.querySelectorAll('[data-tree-preset]').forEach(button => button.addEventListener('click', () => {
      const preset = button.dataset.treePreset;
      if (button.closest('#settingsModal')) {
        const definitions = { compact:[1,0,1,0,0,0,0,0], sizes:[1,1,1,1,1,0,0,0], metadata:[1,1,0,0,0,1,1,0], permissions:[0,0,0,0,0,1,1,1], full:[1,1,1,1,1,1,1,1] };
        const values = definitions[preset] || definitions.full;
        ['Logical','Allocated','Share','Files','Directories','Modified','Owner','Permissions'].forEach((key,index)=>$(`settingColumn${key}`).checked=!!values[index]);
      } else applyTreePreset(preset);
      $('treeHeaderMenu')?.classList.add('hidden');
    }));
    document.querySelectorAll('#treeHeaderMenu [data-tree-toggle]').forEach(input => input.addEventListener('change', () => {
      state.settings.treeColumns = { ...defaultSettings.treeColumns, ...(state.settings.treeColumns||{}), [input.dataset.treeToggle]: input.checked };
      localStorage.setItem('diskmosaic.settings', JSON.stringify(state.settings));
      applyTreeColumnVisibility(); treeList.refresh();
    }));
    const treeHeader = $('treeHeader');
    treeHeader.addEventListener('contextmenu', event => {
      event.preventDefault(); syncTreeHeaderMenu();
      const menu=$('treeHeaderMenu'); menu.classList.remove('hidden');
      menu.style.left=`${Math.min(event.clientX, window.innerWidth-menu.offsetWidth-8)}px`; menu.style.top=`${Math.min(event.clientY, window.innerHeight-menu.offsetHeight-8)}px`;
    });
    treeHeader.addEventListener('dragstart', event => { const cell=event.target.closest('[data-tree-column]'); if (!cell) return; event.dataTransfer.setData('text/plain',cell.dataset.treeColumn); event.dataTransfer.effectAllowed='move'; });
    treeHeader.addEventListener('dragover', event => { if (event.target.closest('[data-tree-column]')) { event.preventDefault(); event.dataTransfer.dropEffect='move'; } });
    treeHeader.addEventListener('drop', event => {
      const target=event.target.closest('[data-tree-column]'); const source=event.dataTransfer.getData('text/plain'); if (!target || !source || source==='name' || source===target.dataset.treeColumn) return;
      event.preventDefault(); const order=normalizeTreeColumnOrder(state.settings.treeColumnOrder); order.splice(order.indexOf(source),1); order.splice(order.indexOf(target.dataset.treeColumn),0,source); state.settings.treeColumnOrder=order; localStorage.setItem('diskmosaic.settings',JSON.stringify(state.settings)); applyTreeColumnLayout(); treeList.refresh();
    });
    treeHeader.addEventListener('pointerdown', event => {
      const cell=event.target.closest('[data-tree-column]'); if (!cell || event.button!==0 || cell.getBoundingClientRect().right-event.clientX>9) return;
      event.preventDefault(); const key=cell.dataset.treeColumn; const startX=event.clientX; const initial=cell.getBoundingClientRect().width; cell.setPointerCapture?.(event.pointerId);
      const move=e=>{ state.settings.treeColumnWidths={...defaultSettings.treeColumnWidths,...(state.settings.treeColumnWidths||{}),[key]:clamp(initial+e.clientX-startX,window.DiskMosaicLayout.columnMinimum(key),key==='name'?800:360)}; applyTreeColumnLayout(); };
      const up=()=>{ cell.removeEventListener('pointermove',move);cell.removeEventListener('pointerup',up);localStorage.setItem('diskmosaic.settings',JSON.stringify(state.settings));treeList.refresh(); };
      cell.addEventListener('pointermove',move);cell.addEventListener('pointerup',up);
    });
    treeHeader.addEventListener('dblclick', event => {
      const cell=event.target.closest('[data-tree-column]'); if (!cell || cell.getBoundingClientRect().right-event.clientX>12) return;
      event.preventDefault(); event.stopPropagation(); const key=cell.dataset.treeColumn; let width=Math.max(cell.scrollWidth+22, defaultSettings.treeColumnWidths[key]||80);
      for (const row of treeList.layer?.querySelectorAll(`[data-tree-column=\"${key}\"]`)||[]) width=Math.max(width,row.scrollWidth+18);
      state.settings.treeColumnWidths={...defaultSettings.treeColumnWidths,...(state.settings.treeColumnWidths||{}),[key]:clamp(width,window.DiskMosaicLayout.columnMinimum(key),key==='name'?800:360)}; localStorage.setItem('diskmosaic.settings',JSON.stringify(state.settings));applyTreeColumnLayout();treeList.refresh();
    });
    $('selectionActionsButton').addEventListener('click', showSelectionMenu);
    $('selectionMenu').addEventListener('click', event => {
      const button = event.target.closest('button[data-selection-action]');
      if (button) selectionAction(button.dataset.selectionAction).catch(reportError);
    });
    $('historyStoreButton').addEventListener('click', () => { state.analyzing = true; send({ cmd: 'history_store_current' }).catch(reportError); });
    $('historyRefreshButton').addEventListener('click', () => { loadHistory().catch(reportError); loadHistoryExplorer().catch(reportError); });
    $('historyExploreButton').addEventListener('click',()=>exploreHistoryTimeline().catch(reportError));
    $('historyRootSelect').addEventListener('change',()=>exploreHistoryTimeline().catch(reportError));
    $('historyMetric').addEventListener('change',renderHistoryTimeline);
    for (const id of ['historyBeforeSelect', 'historyAfterSelect']) $(id).addEventListener('change', updateHistoryCompareState);
    $('historyComparePairButton').addEventListener('click',()=>compareHistoryPair().catch(reportError));
    $('historyChart').addEventListener('click',pickHistoryPoint);
    $('historyChart').addEventListener('dblclick',event=>{const point=pickHistoryPoint(event);if(point)send({cmd:'history_load',scan_id:point.id}).catch(reportError);});
    $('watchStatus').addEventListener('click', () => {
      if (state.watcherState === 'watching') send({ cmd: 'watch_pause' }).catch(reportError);
      else if (state.watcherState === 'paused') send({ cmd: 'watch_resume' }).catch(reportError);
      else if (state.watcherState === 'overflow_refresh_required' && state.rootNode && !state.scanning) {
        state.watcherRefreshPending = true;
        send({ cmd: 'refresh_selected', node_ids: [state.rootNode.id] }).catch(error => { state.watcherRefreshPending = false; reportError(error); });
      }
    });
    $('commandPaletteInput').addEventListener('input', event => renderCommandPalette(event.target.value));
    $('errorsButton').addEventListener('click', () => showErrors().catch(reportError));
    $('largestLimit').addEventListener('change', () => loadLargest().catch(reportError));
    $('searchForm').addEventListener('submit', event => { event.preventDefault(); runSearch().catch(reportError); });
    $('saveSmartCollectionButton').addEventListener('click',()=>saveSmartCollection().catch(reportError));
    $('updateSmartCollectionButton').addEventListener('click',updateSmartCollection);
    $('openSmartCollectionButton').addEventListener('click',openSmartCollection);
    $('renameSmartCollectionButton').addEventListener('click',()=>renameSmartCollection().catch(reportError));
    $('duplicateSmartCollectionButton').addEventListener('click',duplicateSmartCollection);
    $('deleteSmartCollectionButton').addEventListener('click',deleteSmartCollection);
    $('clearAdvancedFilterButton').addEventListener('click',clearAdvancedFilter);
    $('ageRefreshButton').addEventListener('click',()=>runAgeAnalysis().catch(reportError));
    $('ageColorTreemapButton').addEventListener('click',()=>{state.settings.treemapColorMode='age';localStorage.setItem('diskmosaic.settings',JSON.stringify(state.settings));drawTreemap();toast(t('Treemap color mode set to file age.'));});
    $('cleanupAnalyzeButton').addEventListener('click',()=>runCleanupAnalysis().catch(reportError));
    $('allocationRefreshButton').addEventListener('click',()=>runAllocationAnalysis().catch(reportError));
    $('allocationSort').addEventListener('change',()=>runAllocationAnalysis().catch(reportError));
    $('issuesRefreshButton').addEventListener('click',()=>loadIssuesCenter().catch(reportError));
    $('diagnosticsRefreshButton').addEventListener('click',()=>loadDiagnostics().catch(reportError));
    $('copyDiagnosticsButton').addEventListener('click',()=>api.copyText($('diagnosticsText').textContent).then(()=>toast(t('Diagnostics copied.'))).catch(reportError));
    document.querySelectorAll('[data-report-format]').forEach(button=>button.addEventListener('click',()=>exportProfessionalReport(button.dataset.reportFormat).catch(reportError)));
    $('clearExtensionFilter').addEventListener('click', () => { state.activeExtensions = []; state.activeCategories = []; renderExtensions(); refreshTreemapTypeFilter().catch(reportError); });
    $('showExtensionsButton').addEventListener('click', () => { state.typeMode = 'extension'; state.activeCategories = []; renderExtensions(); refreshTreemapTypeFilter().catch(reportError); });
    $('showCategoriesButton').addEventListener('click', () => { state.typeMode = 'category'; state.activeExtensions = []; renderExtensions(); refreshTreemapTypeFilter().catch(reportError); });

    document.querySelectorAll('.tab').forEach(tab => tab.addEventListener('click', () => setActiveView(tab.dataset.view)));
    document.querySelectorAll('.modal-close').forEach(button => button.addEventListener('click', () => {
      if (button.dataset.close === 'aboutModal') closeAbout();
      else $(button.dataset.close).classList.add('hidden');
    }));

    document.querySelectorAll('[data-sort]').forEach(button => button.addEventListener('click', async () => {
      const field = button.dataset.sort;
      if (state.treeSort.field === field) state.treeSort.descending = !state.treeSort.descending;
      else state.treeSort = { field, descending: field !== 'name' };
      document.querySelectorAll('[data-sort]').forEach(b => {
        b.classList.toggle('sorted', b.dataset.sort === state.treeSort.field);
        const label = b.textContent.replace(/\s[↑↓]$/, '');
        b.textContent = b.dataset.sort === state.treeSort.field ? `${label} ${state.treeSort.descending ? '↓' : '↑'}` : label;
      });
      await reloadTree();
    }));

    document.querySelectorAll('[data-largest-sort]').forEach(button => button.addEventListener('click', () => {
      const field = button.dataset.largestSort;
      if (state.largestSort.field === field) state.largestSort.descending = !state.largestSort.descending;
      else state.largestSort = { field, descending: field === 'size' };
      document.querySelectorAll('[data-largest-sort]').forEach(b => {
        b.classList.toggle('sorted', b.dataset.largestSort === state.largestSort.field);
        const label = b.textContent.replace(/\s[↑↓]$/, '');
        b.textContent = b.dataset.largestSort === state.largestSort.field ? `${label} ${state.largestSort.descending ? '↓' : '↑'}` : label;
      });
      sortLargestRows();
    }));

    document.querySelectorAll('[data-ext-sort]').forEach(button => button.addEventListener('click', () => {
      const field = button.dataset.extSort;
      if (state.extensionSort.field === field) state.extensionSort.descending = !state.extensionSort.descending;
      else state.extensionSort = { field, descending: field !== 'extension' };
      document.querySelectorAll('[data-ext-sort]').forEach(b => {
        b.classList.toggle('sorted', b.dataset.extSort === state.extensionSort.field);
        const label = b.textContent.replace(/\s[↑↓]$/, '');
        b.textContent = b.dataset.extSort === state.extensionSort.field ? `${label} ${state.extensionSort.descending ? '↓' : '↑'}` : label;
      });
      renderExtensions();
    }));

    const canvas = $('treemapCanvas');
    canvas.addEventListener('mousemove', event => showTreemapTooltip(event, hitTreemap(event)));
    canvas.addEventListener('mouseleave', () => showTreemapTooltip(null, null));
    canvas.addEventListener('click', event => selectTreemapItem(hitTreemap(event), event).catch(reportError));
    canvas.addEventListener('dblclick', event => {
      const item = hitTreemap(event);
      if (item?.id == null) return;
      const target = item.kind === 'directory' ? item.id : item.parent_id;
      if (target != null && target !== state.treemapParent) {
        focusTreemap(target, true).catch(reportError);
      }
    });
    canvas.addEventListener('contextmenu', async event => {
      const item = hitTreemap(event);
      if (!item?.id) return;
      event.preventDefault();
      const response = await makeRequest({ cmd: 'get_node', node_id: item.id }, 'node');
      if (response.node) showContextMenu(event, response.node);
    });
    canvas.addEventListener('wheel', event => {
      if (!state.rootNode || Math.abs(event.deltaY) < 2) return;
      event.preventDefault();
      const now = performance.now();
      if (now - state.treemapWheelAt < 180) return;
      state.treemapWheelAt = now;
      if (event.deltaY < 0) {
        const item = hitTreemap(event);
        const target = item?.id != null
          ? (item.kind === 'directory' ? item.id : item.parent_id)
          : treemapFocusCandidate();
        if (target != null && target !== state.treemapParent) focusTreemap(target, true).catch(reportError);
      } else {
        navigateBack().catch(reportError);
      }
    }, { passive: false });
    new ResizeObserver(() => drawTreemap()).observe($('treemapWrap'));
    let tabResizeFrame = 0;
    window.addEventListener('resize', () => {
      cancelAnimationFrame(tabResizeFrame);
      tabResizeFrame = requestAnimationFrame(ensureActiveTabVisible);
    }, { passive: true });
    new ResizeObserver(() => { if(state.historyTimeline && document.getElementById('historyView')?.classList.contains('active')) renderHistoryTimeline(); }).observe($('historyChart').parentElement);

    document.addEventListener('click', event => { if (!event.target.closest('#treeHeaderMenu') && !event.target.closest('#treeHeader')) $('treeHeaderMenu')?.classList.add('hidden'); });
    document.addEventListener('keydown', event => {
      if (event.ctrlKey && !event.altKey && !event.shiftKey && /^[1-7]$/.test(event.key)) {
        const views = ['directory', 'largest', 'duplicates', 'search', 'compare', 'statistics', 'history'];
        event.preventDefault();
        setActiveView(views[Number(event.key) - 1]);
        return;
      }
      const target = event.target;
      const typing = target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement || target?.isContentEditable;
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'p') {
        event.preventDefault(); openCommandPalette(); return;
      }
      if (event.key === 'F9' && !typing) {
        event.preventDefault();
        setTreemapMaximized(!state.treemapMaximized);
        return;
      }
      if (event.key === 'Escape' && !$('aboutModal').classList.contains('hidden')) {
        event.preventDefault();
        closeAbout();
        return;
      }
      if (event.key === 'Escape' && state.treemapMaximized && !document.querySelector('.overlay:not(.hidden)')) {
        event.preventDefault();
        setTreemapMaximized(false);
        return;
      }
      if (event.ctrlKey && !typing && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        setActiveView('search');
        $('searchName').focus();
        return;
      }
      if (!event.ctrlKey || typing) return;
      if (event.key.toLowerCase() === 's' && state.rootNode) {
        event.preventDefault();
        saveSnapshot().catch(reportError);
        return;
      }
      if (event.key.toLowerCase() === 'o') {
        event.preventDefault();
        openSnapshot().catch(reportError);
        return;
      }
      if (event.key === '+' || event.key === '=') {
        event.preventDefault();
        focusSelectedTreemap().catch(reportError);
      } else if (event.key === '-') {
        event.preventDefault();
        navigateBack().catch(reportError);
      } else if (event.key === '0') {
        event.preventDefault();
        focusTreemapRoot().catch(reportError);
      }
    });

    $('treemapCanvas').tabIndex = 0;
    $('treemapCanvas').addEventListener('keydown', event => {
      if (!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','Enter',' '].includes(event.key) || !state.treemapRects.length) return;
      event.preventDefault();
      const interactive=state.treemapRects.filter(r=>r.interactive&&r.id!=null);if(!interactive.length)return;
      let index=Math.max(0,interactive.findIndex(r=>r.id===state.treemapKeyboardId));
      if(event.key==='Home')index=0;else if(event.key==='End')index=interactive.length-1;else if(event.key==='ArrowLeft'||event.key==='ArrowUp')index=(index-1+interactive.length)%interactive.length;else if(event.key==='ArrowRight'||event.key==='ArrowDown')index=(index+1)%interactive.length;
      const item=interactive[index];state.treemapKeyboardId=item.id;state.treemapHover=item;drawTreemap();
      $('treemapCanvas').setAttribute('aria-label',`${item.name||item.path||'Treemap item'} · ${formatSize(item.size)} · ${t('Press Enter to select')}`);
      if(event.key==='Enter'||event.key===' '){selectNode(item.id,{ctrl:event.ctrlKey}).catch(reportError);}
    });

    $('duplicateList').tabIndex = 0;
    $('duplicateList').addEventListener('keydown', event => {
      if (!['ArrowDown','ArrowUp','Home','End'].includes(event.key) || !state.duplicateRows.length) return;
      event.preventDefault();
      const groups=state.duplicateRows.map((row,index)=>row.type==='group'?index:null).filter(index=>index!=null);
      if(!groups.length)return; state.duplicateKeyboardIndex=state.duplicateKeyboardIndex??0;
      if(event.key==='ArrowDown')state.duplicateKeyboardIndex=Math.min(groups.length-1,state.duplicateKeyboardIndex+1);
      else if(event.key==='ArrowUp')state.duplicateKeyboardIndex=Math.max(0,state.duplicateKeyboardIndex-1);
      else if(event.key==='Home')state.duplicateKeyboardIndex=0; else state.duplicateKeyboardIndex=groups.length-1;
      duplicateList.element.scrollTop=groups[state.duplicateKeyboardIndex]*duplicateList.rowHeight;
    });

    $('contextMenu').addEventListener('click', event => {
      const button = event.target.closest('button[data-action]');
      if (button && !button.disabled) contextAction(button.dataset.action).catch(reportError);
    });
    document.addEventListener('pointerdown', event => {
      if (!$('contextMenu').contains(event.target)) hideContextMenu();
      if (!$('selectionMenu').contains(event.target) && event.target !== $('selectionActionsButton')) $('selectionMenu').classList.add('hidden');
    });
    window.addEventListener('blur', hideContextMenu);
  }

  function el(tag, className = '', text = '') {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== '') node.textContent = text;
    return node;
  }

  function ellipsizeCanvasText(ctx, text, maxWidth) {
    const source = String(text || '');
    if (!source || !Number.isFinite(maxWidth) || maxWidth <= 0) return '';
    if (ctx.measureText(source).width <= maxWidth) return source;
    const ellipsis = '...';
    if (ctx.measureText(ellipsis).width > maxWidth) return '';
    let low = 0;
    let high = source.length;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      const candidate = `${source.slice(0, mid)}${ellipsis}`;
      if (ctx.measureText(candidate).width <= maxWidth) low = mid;
      else high = mid - 1;
    }
    return `${source.slice(0, low)}${ellipsis}`;
  }

  function integer(value) { return Number(value || 0).toLocaleString(i18n?.locale?.() || undefined); }

  function formatSize(bytes) {
    let n = Number(bytes || 0);
    if (!Number.isFinite(n)) n = 0;
    const iec = state.settings?.units !== 'si';
    const base = iec ? 1024 : 1000;
    const units = iec ? ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB', 'EiB'] : ['B', 'kB', 'MB', 'GB', 'TB', 'PB', 'EB'];
    let unit = 0;
    while (Math.abs(n) >= base && unit < units.length - 1) { n /= base; unit += 1; }
    const digits = unit === 0 ? 0 : n >= 100 ? 0 : n >= 10 ? 1 : 2;
    const formatted = new Intl.NumberFormat(i18n?.locale?.() || undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n);
    return `${formatted} ${units[unit]}`;
  }

  function parseSize(text) {
    const value = text.trim();
    if (!value) return null;
    const match = value.match(/^([0-9]+(?:[.,][0-9]+)?)\s*(b|kb|kib|mb|mib|gb|gib|tb|tib|pb|pib)?$/i);
    if (!match) return null;
    const number = Number(match[1].replace(',', '.'));
    const unit = (match[2] || 'b').toLowerCase();
    const powers = { b: [1,0], kb:[1000,1], mb:[1000,2], gb:[1000,3], tb:[1000,4], pb:[1000,5], kib:[1024,1], mib:[1024,2], gib:[1024,3], tib:[1024,4], pib:[1024,5] };
    const [base, power] = powers[unit];
    return Math.floor(number * (base ** power));
  }

  function formatElapsed(ms) {
    const sec = Math.floor(Number(ms || 0) / 1000);
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
  }

  function formatDate(ms) {
    if (!ms) return '—';
    try { return new Date(Number(ms)).toLocaleString(i18n?.locale?.() || undefined); } catch (_) { return '—'; }
  }

  function displayExtension(extension) { return extension || '(none)'; }

  function colorForExtension(extension) {
    const text = extension || '(none)';
    let hash = 2166136261;
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    const hue = Math.abs(hash) % 360;
    return `hsl(${hue} 64% 48%)`;
  }

  function treemapColorForExtension(extension) {
    if (state.settings?.treemapColorMode === 'extension') return colorForExtension(extension);
    return categoryForExtension(extension).color;
  }

  function ageColor(modifiedMs) {
    if (!modifiedMs) return '#687786';
    const days = Math.max(0, (Date.now() - Number(modifiedMs)) / 86400000);
    if (days < 7) return '#2aa876';
    if (days < 30) return '#4fae69';
    if (days < 183) return '#8da85a';
    if (days < 365) return '#b79a4f';
    if (days < 730) return '#c77847';
    if (days < 1825) return '#b85b58';
    return '#8b6477';
  }

  function treemapColorForItem(item) {
    if (state.settings?.treemapColorMode === 'age' && item.kind === 'file') return ageColor(item.modified_ms);
    return treemapColorForExtension(item.extension);
  }

  function polygon(ctx, points) {
    if (!points?.length) return;
    ctx.beginPath(); ctx.moveTo(points[0][0], points[0][1]);
    for (let i=1;i<points.length;i+=1) ctx.lineTo(points[i][0], points[i][1]);
    ctx.closePath();
  }

  function drawExtrudedTile(ctx, x, y, w, h, baseColor, strength) {
    const geometry = window.DiskMosaicTreemap.extrusion({ x, y, w, h }, strength);
    if (geometry.degraded) {
      // Microscopic rectangles cannot show four separate raised faces. Keep the
      // authoritative footprint intact rather than spilling into a neighbor.
      ctx.save();
      ctx.fillStyle = baseColor;
      ctx.fillRect(x, y, w, h);
      ctx.restore();
      return geometry;
    }

    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();

    // A dark backing layer provides separation between the four raised faces.
    ctx.fillStyle = 'rgba(0,0,0,.38)';
    ctx.fillRect(x, y, w, h);

    const paintFace = (points, shade) => {
      polygon(ctx, points);
      ctx.fillStyle = baseColor;
      ctx.fill();
      polygon(ctx, points);
      ctx.fillStyle = shade;
      ctx.fill();
    };

    // The front is inset on all four sides. A gentle diagonal shade makes it
    // read as the raised top surface rather than a flat beveled square.
    polygon(ctx, geometry.front);
    ctx.fillStyle = baseColor;
    ctx.fill();
    const frontShade = ctx.createLinearGradient(x + geometry.depth, y + geometry.depth, x + w - geometry.depth, y + h - geometry.depth);
    frontShade.addColorStop(0, 'rgba(255,255,255,.24)');
    frontShade.addColorStop(0.42, 'rgba(255,255,255,.07)');
    frontShade.addColorStop(0.72, 'rgba(0,0,0,.05)');
    frontShade.addColorStop(1, 'rgba(0,0,0,.22)');
    polygon(ctx, geometry.front);
    ctx.fillStyle = frontShade;
    ctx.fill();

    // Four surrounding trapezoid faces. Lighting comes from the upper-left:
    // top/left are brighter, right is darker, and bottom is darkest.
    const topShade = ctx.createLinearGradient(x, y, x, y + Math.max(1, geometry.depth));
    topShade.addColorStop(0, 'rgba(255,255,255,.56)');
    topShade.addColorStop(1, 'rgba(255,255,255,.16)');
    paintFace(geometry.top, topShade);

    const leftShade = ctx.createLinearGradient(x, y, x + Math.max(1, geometry.depth), y);
    leftShade.addColorStop(0, 'rgba(255,255,255,.32)');
    leftShade.addColorStop(1, 'rgba(255,255,255,.08)');
    paintFace(geometry.left, leftShade);

    const rightShade = ctx.createLinearGradient(x + w - geometry.depth, y, x + w, y);
    rightShade.addColorStop(0, 'rgba(0,0,0,.18)');
    rightShade.addColorStop(1, 'rgba(0,0,0,.58)');
    paintFace(geometry.right, rightShade);

    const bottomShade = ctx.createLinearGradient(x, y + h - geometry.depth, x, y + h);
    bottomShade.addColorStop(0, 'rgba(0,0,0,.22)');
    bottomShade.addColorStop(1, 'rgba(0,0,0,.66)');
    paintFace(geometry.bottom, bottomShade);

    // Crisp boundaries make all four extrusion faces visible even on modest
    // rectangles while the original outer rectangle remains the hit target.
    ctx.strokeStyle = 'rgba(0,0,0,.84)';
    ctx.lineWidth = 1.05;
    for (const face of [geometry.top, geometry.right, geometry.bottom, geometry.left, geometry.front]) {
      polygon(ctx, face);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(255,255,255,.25)';
    ctx.beginPath();
    ctx.moveTo(geometry.front[0][0] + .5, geometry.front[0][1] + .5);
    ctx.lineTo(geometry.front[1][0] - .5, geometry.front[1][1] + .5);
    ctx.stroke();
    ctx.restore();
    return geometry;
  }

  function directoryColor(id) {
    const hue = (210 + (Number(id || 0) * 17)) % 360;
    return `hsl(${hue} 22% 42%)`;
  }

  function toast(message, error = false) {
    const node = $('toast');
    node.textContent = message;
    node.style.background = error ? 'var(--danger)' : 'var(--text)';
    node.classList.remove('hidden');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => node.classList.add('hidden'), error ? 6000 : 3000);
  }

  function refreshVisibleDataViews() {
    treeList.refresh();
    largestList.refresh();
    searchList.refresh();
    duplicateList.refresh();
    compareList.refresh();
    extensionList.refresh();
    if (state.historyTimeline && document.getElementById('historyView')?.classList.contains('active')) renderHistoryTimeline();
    drawTreemap();
  }

  let layoutRefreshTimer = null;
  function scheduleLayoutRefresh() {
    clearTimeout(layoutRefreshTimer);
    layoutRefreshTimer = setTimeout(() => {
      requestAnimationFrame(() => refreshVisibleDataViews());
    }, 40);
  }

  window.addEventListener('resize', scheduleLayoutRefresh, { passive: true });

  state.settings = loadSettings();
  state.sizeBasis = state.settings.sizeBasis === 'allocated' ? 'allocated' : 'logical';
  $('duplicateMinSize').value = state.settings.duplicateMinSize || '1 MiB';
  renderSavedLocations();
  loadSmartCollections();
  applySettings();
  restoreWorkspaceState();
  setupSplitters();
  setupLayoutContainers();
  setupEvents();
})();
