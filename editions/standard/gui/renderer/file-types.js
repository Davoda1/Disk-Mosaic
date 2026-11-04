(() => {
  'use strict';

  // DiskMosaic's built-in file recognition table. The generic coverage below
  // comes from the extension coverage list. Multiple extensions share
  // family artwork; source languages/toolchains receive distinct compact badges.
  // No third-party logos or icon packs are copied.
  const SECTION_GROUPS = Object.freeze([
    ["ARCHIVES / COMPRESSED", "archive", "ARC", "Archive / compressed file", "Archives", ".zip .rar .7z .tar .gz .tgz .taz .bz2 .tbz2 .xz .txz .lz .lzma .tlz .zst .tzst .lz4 .br .z .cpio .pax .shar .ar .a .rpm .deb .udeb .ddeb .pkg .p5p .apk .aab .xapk .apks .apkm .jar .war .ear .whl .egg .nupkg .gem .xpi .crx .user.js .dmg .sparseimage .sparsebundle .sit .sea .hqx .binhex .wim .swm .esd .appx .msix .appxbundle .msixbundle .snap .flatpakref .flatpakrepo .appimage .zpaq .ace .alz .arc .arj .lzh .lha .zoo .zsplit .001 .002 .r00 .r01 .z01 .z02 .gz2 .bz3"],
    ["DOCUMENTS / TEXT / EBOOKS", "document", "DOC", "Document / text / e-book", "Documents", ".txt .text .nfo .diz .ans .asc .rtf .doc .docx .docm .dot .dotx .dotm .odt .ott .sxw .stw .wpd .wps .mcw .wks .abw .zabw .gdoc .pages .tex .ltx .sty .cls .bst .dtx .ins .bib .aux .bbl .blg .toc .lof .lot .out .nav .snm .vrb .synctex.gz .run.xml .bcf .thm .idx .ind .ilg .glo .gls .glg .acn .acr .alg .brf .maf .mtc .nlo .nls .pyg .listing .lol .tdo .xdy .ist .fdb_latexmk .fls .pdf .xps .oxps .ps .eps .dvi .xdv .djvu .djv .epub .mobi .azw .azw3 .azw4 .kfx .kf8 .fb2 .fb2.zip .pdb .prc .lrf .lrx .tcr .lit .chm .ibooks .kepub .cbz .cbr .cb7 .cbt .cba .md .markdown .mdown .mkd .rst .adoc .asciidoc .org .textile .creole .wiki .mediawiki .pod .pod6 .rdoc .tr .man .1 .2 .3 .3pm .3x .4 .5 .6 .7 .8 .9 .info .texi .texinfo .mht .mhtml .maff .webarchive"],
    ["SPREADSHEETS / DATA", "spreadsheet", "DATA", "Spreadsheet / structured data", "Documents", ".xls .xlsx .xlsm .xlsb .xlt .xltx .xltm .xlam .xla .ods .ots .fods .csv .tsv .psv .dsv .dif .slk .sylk .numbers .gsheet .wk1 .wk3 .wk4 .123 .qpw .et .sxc .stc .parquet .orc .avro .feather .arrow .ipc .h5 .hdf5 .hdf .he5 .nc .nc4 .cdf .zarr .n5 .npy .npz .pkl .pickle .joblib .msgpack .cbor .bson .dat .data .json .json5 .jsonc .geojson .topojson .har .yaml .yml .toml .ini .cfg .conf .properties .env .xml .xsl .xslt .xsd .dtd .ent .rss .atom .plist .strings .stringsdict"],
    ["PRESENTATIONS", "presentation", "PRES", "Presentation", "Documents", ".ppt .pptx .pptm .pot .potx .potm .pps .ppsx .ppam .ppa .odp .otp .fodp .key .gslides .shw .sxi .sti .dps .dpt .odg .otg .fodg"],
    ["IMAGES (raster, vector, raw, GPU, scientific)", "image", "IMG", "Image / graphics", "Images", ".jpg .jpeg .jpe .jfif .png .apng .gif .bmp .dib .tif .tiff .webp .avif .heic .heif .heics .heifs .jxl .jxr .hdp .wdp .ico .cur .ani .icns .svg .svgz .ai .eps .ps .pdf .raw .cr2 .cr3 .crw .nef .nrw .arw .srf .sr2 .orf .rw2 .pef .dng .raf .x3f .mrw .dcr .kdc .erf .3fr .fff .iiq .mef .mos .rwl .srw .psd .psb .xcf .xcf.gz .kra .clip .sai .sai2 .mdp .ora .pdn .pxd .pxr .pdd .pns .jps .mpo .pcx .tga .targa .ppm .pgm .pbm .pnm .pam .exr .hdr .pic .pict .pct .sgi .rgb .rgba .bw .int .inta .xpm .xbm .xwd .fits .fts .fit .jp2 .j2k .jpf .jpx .jpm .mj2 .wmf .emf .cgm .qoi .bpg .flif .mng .dds .ktx .ktx2 .pvr .pkm .astc .basis .img .dpx .cin .r3d .braw .cine .drw .dwg .dxf"],
    ["AUDIO", "audio", "AUD", "Audio", "Audio", ".mp3 .mp2 .mp1 .aac .m4a .m4b .m4p .m4r .aa .aax .flac .ogg .oga .opus .spx .wav .wave .wma .wax .aif .aiff .aifc .au .snd .caf .dsf .dff .dsd .ape .mpc .mp+ .mpp .wv .tta .shn .ac3 .eac3 .dts .dtshd .mlp .mka .ra .rm .rma .ram .cda .mid .midi .rmi .kar .mod .s3m .xm .it .mtm .umx .mo3 .stm .669 .far .med .okt .ptm .ult .amf .gym .psf .minipsf .psf2 .minipsf2 .ssf .minissf .gsf .minigsf .usf .miniusf .spc .vgm .vgz .ay .gbs .nsf .hes .kss .sap .sid .abc .mus .gp .gp3 .gp4 .gp5 .gpx .ptb .mscz .mscx .ly .musicxml .mxl .rpp .als .flp .cpr .logic .logicx .band .ptx .ptf .sesx .ses .aup .aup3 .pcm .raw"],
    ["VIDEO", "video", "VID", "Video", "Video", ".mp4 .m4v .mov .qt .avi .wmv .wmx .asf .asx .flv .f4v .f4p .f4a .f4b .webm .mkv .mk3d .mks .mpg .mpeg .mpe .mpv .m2v .m2p .m2ts .mts .ts .tp .trp .tivo .vob .ifo .bup .ogv .ogm .ogx .rm .rmvb .divx .xvid .3gp .3g2 .3gpp .3gpp2 .amv .mxf .dv .dif .fli .flc .flx .smk .bik .swf .yuv .gxf .hevc .m2t .mod .tod .vro .dat .r3d .braw .prores .dnxhd .dnxhr .dpx .exr .j2c .nut .nsv .vivo .viv .strm .usm .pss .pam .thp .sofdec .cpk .roq .cin"],
    ["PLAYLISTS / SUBTITLES", "subtitle", "SUB", "Playlist / subtitle", "Subtitles", ".m3u .m3u8 .pls .xspf .asx .wpl .zpl .fpl .vlc .b4s .aimppl .cue .srt .sub .ass .ssa .vtt .webvtt .ttml .dfxp .sami .smi .stl .scc .cap .mpl .rt .usf .jss .aqt .jacosub .psb .pjs .dksub .son .sup .pgs .idx"],
    ["EXECUTABLES / LIBRARIES / OBJECT CODE", "executable", "BIN", "Executable / library / object code", "Executables", ".exe .com .scr .msi .msp .mst .msu .cpl .dll .ocx .sys .drv .efi .vxd .pif .gadget .app .command .workflow .action .applescript .scpt .scptd .bin .run .sh .bash .zsh .fish .ksh .csh .tcsh .elf .so .so.* .ko .ko.xz .ko.zst .ko.gz .a .o .obj .lib .exp .pdb .ilk .idb .dylib .bundle .framework .kext .class .pyc .pyo .pyd .dex .odex .oat .art .vdex .smali .arsc .nib .xib .storyboard .mom .momd .car .tbd .swiftmodule .swiftdoc .swiftsourceinfo .gch .pch .res .rc .resources .appimage .snap .flatpakref .deb .rpm .pkg .ipk .opkg .xbps .apk .aab .xapk .apks .apkm .ipa .appx .msix .appxbundle .msixbundle"],
    ["SOURCE CODE / SCRIPTS", "code", "SRC", "Source code / script", "Development", ".c .h .cpp .cc .cxx .c++ .hpp .hh .hxx .h++ .ipp .tpp .inl .m .mm .swift .java .kt .kts .scala .sc .groovy .gvy .gy .gsh .cs .fs .fsi .fsx .fsscript .vb .bas .cls .frm .vbs .vbe .wsc .wsf .hta .js .mjs .cjs .jsx .ts .tsx .mts .cts .coffee .litcoffee .dart .py .pyi .pyw .pyx .pxd .pxi .ipynb .rb .erb .haml .slim .rake .gemspec .php .phtml .php3 .php4 .php5 .phps .phar .pl .pm .t .pod .raku .rakumod .rakutest .lua .moon .tcl .tk .exp .ps1 .psm1 .psd1 .ps1xml .psc1 .bat .cmd .nt .reg .inf .ahk .au3 .e .ex .exs .erl .hrl .xrl .yrl .escript .hs .lhs .cabal .elm .purs .reason .rei .res .resi .ml .mli .mll .mly .clj .cljs .cljc .edn .lisp .lsp .fasl .el .scm .ss .rkt .nim .nims .cr .go .mod .sum .rs .rlib .d .di .zig .zon .v .vsh .odin .jai .carbon .mojo .jl .r .rmd .rdata .rds .rda .sas .do .ado .mat .slx .mdl .fig .mlx .f .for .f77 .f90 .f95 .f03 .f08 .f15 .fpp .cob .cbl .cpy .pas .pp .inc .lpr .lfm .lpi .ada .adb .ads .asm .s .i .ii .nasm .a51 .8051 .cu .cuh .cl .glsl .vert .frag .geom .tesc .tese .comp .hlsl .fx .fxh .cg .metal .spv .wgsl .shader .cginc .usf .ush .proto .thrift .avsc .avdl .graphql .gql .sol .move .cairo .vy .vyi .wat .wasm .wast .bicep .hcl .tf .tfvars .nomad .dockerfile .makefile .mk .am .in .ac .m4 .cmake .pri .pro .qbs .gradle .sbt .pom"],
    ["WEB", "web", "WEB", "Web / frontend file", "Development", ".html .htm .xhtml .xht .shtml .stm .asp .aspx .ascx .ashx .asmx .axd .cshtml .vbhtml .jsp .jspx .jspf .do .action .cfm .cfml .cfc .twig .blade.php .mustache .hbs .handlebars .ejs .pug .jade .njk .liquid .vue .svelte .astro .css .scss .sass .less .styl .stylus .pcss .postcss .webmanifest .woff .woff2 .ttf .otf .eot .ics .vcf .vcard .url .lnk .desktop .directory .webloc .inetloc"],
    ["CONFIG / DOTFILES / SYSTEM CONFIG", "config", "CFG", "Configuration / system configuration", "Development", ".conf .cfg .ini .inf .reg .properties .env .profile .bashrc .bash_profile .bash_login .bash_logout .zshrc .zprofile .zshenv .zlogin .zlogout .inputrc .vimrc .gvimrc .exrc .gitconfig .gitignore .gitattributes .gitmodules .npmrc .yarnrc .nvmrc .node-version .python-version .ruby-version .gemrc .irbrc .pryrc .condarc .wgetrc .curlrc .netrc .xresources .xdefaults .xinitrc .xsession .xprofile .tmux.conf .screenrc .htoprc .nanorc .editorconfig .clang-format .clang-tidy .prettierrc .eslintrc .stylelintrc .babelrc .browserslistrc .tool-versions .envrc .procfile .dockerignore .gitpod.yml .travis.yml .gitlab-ci.yml .drone.yml .jenkinsfile .vagrantfile .terraformrc .ansible.cfg .inventory .hosts .sudoers .fstab .crontab .exports .sysctl.conf .modules .service .socket .device .mount .automount .swap .target .path .timer .slice .scope .network .netdev .link .rules .hwdb .sysusers .tmpfiles .preset .nix .flake.nix .guix .desktop .directory .theme .colorscheme .qml .ui .glade .fxml .axml .layout .menu .anim .controller .prefab .asset .mat .unitypackage .unity .meta .asmdef .asmref .rsp .compute .godot .tscn .tres .gd .gdshader .import .stex .ctex .sample .translation .remap .uid .uproject .uplugin .uasset .umap .uexp .ubulk"],
    ["DATABASES", "database", "DB", "Database", "Data / game assets", ".db .db3 .sqlite .sqlite3 .s3db .sl3 .mdb .accdb .mde .accde .accdr .accdt .adp .ade .frm .myd .myi .ibd .ndb .dbf .dbt .fpt .prj .gdb .gdbtable .gdbindexes .spx .freelist .db-shm .db-wal .sqlite-shm .sqlite-wal .duckdb .ldb .sst .idb .fdb .udl .dsn .odc .rdl .qvw .qvd .twb .twbx .hyper .pbix .pbids .bim .sql .ddl .dml .sqlite-journal"],
    ["DISK / FILESYSTEM IMAGES", "disk", "DSK", "Disk / filesystem image", "Disk images", ".iso .img .ima .dmg .sparseimage .sparsebundle .vhd .vhdx .avhd .avhdx .vmdk .vmdi .vmsd .vmsn .vmss .vmtm .vmx .vmxf .nvram .vdi .hdd .hds .pvs .pvm .qcow .qcow2 .qed .raw .dd .bin .cue .toc .nrg .mdf .mds .ccd .sub .isz .daa .xdi .b5t .b6t .bwt .cdi .cif .c2d .pdi .vcd .svcd .dvd .udf .wim .swm .esd .gho .tib .tibx .v2i .pqi .adi .mrimg .spfs .squashfs .sfs .cloop .woz .dsk .nib .do .po .2mg .hdv .adf .adz .dms .ipf .caps .ctr .st .msa .dim .hdm .xdf .fdi .fdd .tfd .hdf .hdx .vfd .vdp .ext2 .ext3 .ext4 .btrfs .xfs .f2fs .nilfs2 .jffs2 .ubifs .yaffs2 .cramfs .romfs .rootfs .wic"],
    ["FONTS", "font", "FONT", "Font", "Other", ".ttf .otf .woff .woff2 .eot .fon .fnt .ttc .otc .pfb .pfm .afm .bdf .pcf .pcf.gz .snf .psf .psfu .psf.gz .psfu.gz .sfd .ufo .glyphs .vfb .vfk .vf .wfn .acfm .amfm .dfont .suit .lwfn .ff .bmap .otd .pfa"],
    ["CERTIFICATES / CRYPTO / SECURITY", "security", "SEC", "Certificate / crypto / security data", "Other", ".pem .crt .cer .der .p7b .p7c .p7m .p7r .p7s .p12 .pfx .key .csr .crl .ca-bundle .cert .p10 .spc .pvk .sct .jks .keystore .truststore .asc .gpg .pgp .sig .sign .sigstore .minisig .ed25519 .ssh .ppk .ovpn .pcap .pcapng .cap .dmp .har .enc .age"],
    ["EMAIL / PIM", "email", "MAIL", "Email / personal information data", "Documents", ".eml .msg .mbox .mbx .pst .ost .oab .oft .ics .vcf .vcard .emlx .p7s .mht .mhtml .maff .one .onetoc2 .enex .mmap .xmind .mm .mmat .mindnode"],
    ["CAD / 3D / MANUFACTURING", "model", "3D", "CAD / 3D / manufacturing", "Data / game assets", ".dwg .dxf .dwt .dws .dgn .ifc .ifcxml .ifczip .rvt .rfa .rte .rft .skp .skb .3ds .max .blend .blend1 .blend2 .fbx .obj .mtl .stl .step .stp .iges .igs .x_t .x_b .sat .sab .jt .prt .asm .drw .sldprt .sldasm .slddrw .catpart .catproduct .catdrawing .model .session .exp .cad .dwf .dwfx .u3d .prc .3mf .amf .gcode .gco .g .nc .tap .ngc .drl .exc .plt .hpgl .glb .gltf .usd .usda .usdc .usdz .abc .vdb .bgeo .geo .hip .hiplc .hipnc .rat .pic .exr .sim .sc .anim .ma .mb .mel .mll .nk .gizmo .aep .aepx .c4d .lwo .lw .lws .lxo .ply .pts .ptx .e57 .las .laz .pcd .xyz .asc .fls .fws .wrl .vrml .x3d .x3dv .x3db .dae .kmz .kml"],
    ["GIS / GEOSPATIAL", "gis", "GIS", "GIS / geospatial data", "Data / game assets", ".shp .shx .dbf .prj .cpg .sbn .sbx .fbn .fbx .ain .aih .ixs .mxs .atx .qmd .qgs .qgz .qlr .qml .gpkg .gdb .mdb .sqlite .geojson .topojson .kml .kmz .gml .gpx .fit .tcx .osm .pbf .mbtiles .vrt .tiff .tif .geotiff .ecw .jp2 .sid .img .asc .dem .usgs .hdr .bil .bis .blw .adf .aux .aux.xml .rrd .ovr .tab .map .id .dat .ind .mid .mif .lyr .lyrx .mxd .mxt .nmf .3dd .sxd .style .stylx .tbx .atbx .pyt .sde"],
    ["DESIGN / GRAPHICS PROJECTS", "design", "DES", "Design / graphics project", "Images", ".psd .psb .ai .eps .indd .indl .indt .idml .inx .pmd .qxp .qct .qwd .sketch .fig .xd .afdesign .afphoto .afpub .cdr .cdt .cmx .vsd .vsdx .vss .vssx .vst .vstx .vdx .vsdm .vssm .vstm .emf .wmf .svg .svgz .ora .kra .xcf .clip .sai .sai2 .mdp .pdn .pxd .pxr .pdd .pns .jps .mpo .pen .bmpr .rp .rplib .bmml .graffle .gdiagramstyle .gstencil .gtemplate .omnigraffle"],
    ["BACKUP / TEMP / EDITOR SWAP", "backup", "BAK", "Backup / temporary / swap file", "Other", ".bak .backup .old .orig .tmp .temp .swp .swo .swn .swm .swl .swk .swj .swi .swh .swg .swf .swe .swd .swc .swb .swa .save .save.1 .save.2 .sav .bkf .bkp .rej .diff .patch .lock .pid .sock .socket .fifo .pipe"],
    ["FIRMWARE / EMBEDDED", "firmware", "FW", "Firmware / embedded image", "Data / game assets", ".bin .hex .ihex .mcs .srec .s19 .mot .elf .axf .out .coff .aout .uf2 .dfu .fw .img .rom .bios .uefi .fd .cap .efi .nsh .dts .dtsi .dtb .dtbo .its .fit .uimage .zimage .u-boot .spl .tpl .mtd .jffs2 .ubifs .squashfs .cramfs .romfs"],
    ["MOBILE / CONSOLE / GAME ROMS", "game", "ROM", "Mobile / console / game ROM", "Data / game assets", ".apk .aab .xapk .apks .apkm .obb .jar .jad .sis .sisx .ipa .app .mobileprovision .provisionprofile .entitlements .dex .odex .oat .art .vdex .smali .arsc .rso .nro .nso .nca .nsp .xci .cia .3ds .cci .cxi .nds .dsi .gba .gbc .gb .nes .fds .sfc .smc .fig .swc .smd .gen .bin .md .gg .sms .pce .sgx .ngp .ngc .vb .ws .wsc .a26 .a78 .lnx .jag .cdi .chd .gcm .rvz .wbfs .wad .dol .elf .tmd .tik .cert .bnr .sav .srm .eep .fla .sra .st0"],
    ["GAME SAVES / MODS / ENGINE ASSETS", "game", "GAME", "Game save / mod / engine asset", "Data / game assets", ".sav .srm .eep .fla .sra .st0 .dat .save .world .level .map .bsp .md3 .md5 .pk3 .pk4 .vpk .gma .vmf .vmt .vtf .nav .ain .cfg .res .dem .rec .roq .cin .bik .usm .pss .pam .thp .sofdec .cpk .afs .big .viv .far .w3d .w3x .w3m .w3n .scx .scm .sc2map .sc2archive .sc2replay .sv6 .sv4 .sv7 .park .park3 .td6 .td4 .rct2 .rct1 .obj .mb .ma .blend .fbx .3ds .max .skp .nif .kf .kfm .dds .tga .bmp .png .jpg .psd .ani .cur .fnt .bmf .sprite .sprite2 .sprite3 .ttf .otf .otc .ttc .bdf .pcf .wav .ogg .mp3 .flac .xm .it .mod .s3m .mo3 .umx .bank .fsb .bnk .wem .pck .acb .awb .hca .adx .ast .brstm .bcstm .bfstm .bcsar .bfwar .bfsar .brsar .rseq .rsar .rwar .rwav .rstm .strm .ssar .seq .sdat .sseq .swav .swar"],
    ["WINDOWS SYSTEM", "system", "WIN", "Windows system file", "Other", ".dll .exe .sys .drv .ocx .cpl .msc .msi .msp .mst .msu .cab .cat .inf .ini .reg .lnk .url .pif .scr .hlp .chm .cnt .gid .fts .grp .dat .tmp .temp .bak .old .orig .dmp .hdmp .mdmp .wer .etl .evtx .evt .blg .perfmon .adm .admx .adml .pol .gppref .gpt .ntuser.dat .usrclass.dat .sam .security .software .system .default .bcd .boot .win .wim .swm .esd .vhd .vhdx .efi .nls .fon .fnt .ttf .otf .compositefont .theme .themepack .deskthemepack .msstyles .cur .ani .ico .icl .dll.mui .exe.mui .diagpkg .diagcfg .diagcab .msrcincident .ms-settings .appx .appxbundle .msix .msixbundle .appxupload .msixupload .pri .priconfig .resources.pri .winmd .tlb .olb .exp .lib .pdb .ilk .idb .obj .res .rc .aps .suo .user .csproj .vbproj .fsproj .vcxproj .sln .slnf .props .targets .ruleset .analyzers .editorconfig .globalconfig .runsettings .testsettings .loadtest .webtest .orderedtest .trx .coverage .coveragexml .gcov .lcov .profraw .profdata .nettrace .diagsession .diagnostic"],
    ["macOS SYSTEM", "system", "MAC", "macOS system file", "Other", ".app .framework .kext .bundle .plugin .prefpane .saver .mdimporter .qlgenerator .spotlightimporter .action .workflow .applescript .scpt .scptd .appex .extension .appextension .driverkit .dext .systemextension .endpointsecurity .networkextension .dmg .sparseimage .sparsebundle .pkg .mpkg .dist .distz .bom .pbzx .xar .cpgz .cpio .sit .sea .hqx .binhex .webloc .inetloc .bookmark .alias .sbookmark .savedsearch .mobileconfig .mobileprovision .provisionprofile .cer .p12 .keychain .keychain-db .entitlements .plist .strings .stringsdict .nib .xib .storyboard .storyboardc .car .xcassets .xcstickers .appiconset .imageset .colorset .symbolset .xcappdata .xcarchive .xcworkspace .xcodeproj .pbxproj .xcconfig .xcuserstate .xccheckout .xcscmblueprint .xcuserdatad .xcscheme .xcclassmodel .xcdatamodel .xcdatamodeld .xcmappingmodel .mom .momd .cdm .sqlite .sqlite3 .db .storedata .coredata .coredatamodel .icns .tiff .pict .pct .qtif .qti .qtz .qtl .qtx .qtxt .qtxml .qt .mov .m4v .mp4 .aiff .aif .aifc .caf .au .snd .wav .mp3 .m4a .m4b .m4p .m4r .aa .aax .midi .mid .pages .numbers .key .template .efx .mac .clipping .textclipping .pictclipping .webarchive .webbookmark .webhistory .download .safariextz .webplugin .speechvoice .speechrecognition .speechsynthesis .textexpander .telemetry .crash .ips .panic .spin .hang .diag .logarchive .trace .tracev3 .instrument .run .chord .storekit .storekitdata"],
    ["LINUX SYSTEM", "system", "LNX", "Linux system file", "Other", ".deb .rpm .pkg.tar.zst .pkg.tar.xz .txz .tbz .tgz .run .sh .bash .zsh .fish .ksh .csh .tcsh .desktop .directory .service .socket .device .mount .automount .swap .target .path .timer .slice .scope .network .netdev .link .snapshot .override .conf .cfg .ini .rules .udev .hwdb .sysusers .tmpfiles .preset .kernel-install .initrd .img .vmlinuz .bzimage .zimage .efi .ko .ko.xz .ko.zst .ko.gz .mod .mod.c .cmd .order .builtin .symvers .config .config.old .version .d .o .o.* .a .so .so.* .la .lai .lo .pc .cmake .cmake.in .pc.in .spec .changes .dsc .orig.tar.gz .debian.tar.xz .buildinfo .build .udeb .ddeb .snap .flatpakref .flatpakrepo .appimage .makeself .nix .guix .ebuild .eclass .exheres-0 .pacman .yaourt .yay .paru .apk .ipk .opkg .xbps .cfs .squashfs .sfs .iso .wic .rootfs .tar .tar.gz .tar.bz2 .tar.xz .tar.zst .tar.lz .tar.lz4 .tar.lzma .taz .tz .tlz .tbz2 .tpz .tzst .srpm .src.rpm"],
    ["SCIENTIFIC / RESEARCH", "scientific", "SCI", "Scientific / research data", "Data / game assets", ".fits .fts .fit .h5 .hdf5 .hdf .he5 .nc .nc4 .cdf .grib .grib2 .grb .grb2 .bufr .bufr4 .bin .dat .data .raw .csv .tsv .ascii .txt .spc .dx .jdx .jcamp .mzml .mzxml .mzdata .mgf .msp .ms .d .wiff .qgd .fid .ser .1r .2rr .acqu .acqus .pdata .out .log .err .inp .input .cfg .conf .par .prm .param .params .json .yaml .yml .toml .xml .nml .namelist .f90 .f95 .f03 .f08 .f .for .f77 .c .cpp .cu .py .jl .r .m .ipynb .tex .bib .sty .cls .bst .dtx .ins .pdf .ps .eps .dvi .xdv"],
    ["TORRENT / P2P / DOWNLOADS", "download", "DL", "Download / P2P metadata", "Other", ".torrent .magnet .nzb .ed2k .emulecollection .partial .!ut .!q .part .download .crdownload .opdownload .aria2"],
    ["LOGS / MISC", "log", "LOG", "Log / miscellaneous file", "Other", ".log .tmp .temp .bak .old .orig .rej .diff .patch .lock .pid .sock .socket .fifo .pipe .lnk .url .desktop .directory .theme .colorscheme .qml .ui .glade .fxml .storyboard .xib .nib .axml .layout .menu .anim .controller .prefab .asset .mat .physicmaterial .rendertexture .guiskin .unitypackage .unity .meta .asmdef .asmref .rsp .cginc .compute .shader .hlsl .glsl .cg .metal .spv .wgsl .usf .ush .uasset .umap .uexp .ubulk .uassetinfo .uexpinfo .uplugin .uproject .godot .tscn .tres .gd .gdshader .import .stex .ctex .otf .ttf .woff .woff2 .sample .translation .remap .uid"],
  ]);

  const SPECIFIC_GROUPS = Object.freeze([
    ["html", "HTML", "HTML / server-side HTML", "code", "Development", ".html .htm .xhtml .xht .shtml .stm"],
    ["asp", "ASP", "ASP / ASP.NET", "code", "Development", ".asp .aspx .ascx .ashx .asmx .axd"],
    ["razor", "Rzr", "Razor", "code", "Development", ".cshtml .vbhtml"],
    ["jsp", "JSP", "Java Server Pages", "code", "Development", ".jsp .jspx .jspf"],
    ["javaweb", "J", "Java web action", "code", "Development", ".do .action"],
    ["coldfusion", "CF", "ColdFusion", "code", "Development", ".cfm .cfml .cfc"],
    ["twig", "Twig", "Twig", "code", "Development", ".twig"],
    ["blade", "Bld", "Blade", "code", "Development", ".blade.php"],
    ["mustache", "Must", "Mustache / Handlebars", "code", "Development", ".mustache .hbs .handlebars"],
    ["ejs", "EJS", "EJS", "code", "Development", ".ejs"],
    ["pug", "Pug", "Pug / Jade", "code", "Development", ".pug .jade"],
    ["nunjucks", "Njk", "Nunjucks", "code", "Development", ".njk"],
    ["liquid", "Liq", "Liquid", "code", "Development", ".liquid"],
    ["vue", "Vue", "Vue", "code", "Development", ".vue"],
    ["svelte", "Sv", "Svelte", "code", "Development", ".svelte"],
    ["astro", "Ast", "Astro", "code", "Development", ".astro"],
    ["css", "CSS", "CSS / PostCSS", "code", "Development", ".css .pcss .postcss"],
    ["sass", "Sass", "Sass / SCSS", "code", "Development", ".scss .sass"],
    ["less", "Less", "Less", "code", "Development", ".less"],
    ["stylus", "Styl", "Stylus", "code", "Development", ".styl .stylus"],
    ["webmanifest", "Man", "Web manifest", "config", "Development", ".webmanifest"],
    ["fontweb", "Font", "Web font", "font", "Development", ".woff .woff2 .ttf .otf .eot"],
    ["calendar", "ICS", "Calendar", "email", "Development", ".ics"],
    ["contact", "VCF", "Contact card", "email", "Development", ".vcf .vcard"],
    ["shortcut", "Link", "Shortcut / desktop link", "system", "Development", ".url .lnk .desktop .directory .webloc .inetloc"],
    ["json", "JSON", "JSON / JSON5 / JSONC", "code", "Development", ".json .json5 .jsonc .geojson .topojson"],
    ["xml", "XML", "XML / schema / transform", "code", "Development", ".xml .xsl .xslt .xsd .dtd .ent .rss .atom"],
    ["yaml", "YAML", "YAML", "code", "Development", ".yaml .yml"],
    ["toml", "TOML", "TOML", "code", "Development", ".toml"],
    ["ini", "INI", "INI / configuration", "config", "Development", ".ini .cfg .conf .properties .env"],
    ["plist", "Plist", "Apple property list", "config", "Development", ".plist .strings .stringsdict"],
    ["git", "Git", "Git configuration", "config", "Development", ".gitconfig .gitignore .gitattributes .gitmodules"],
    ["editor", "Ed", "Editor/tool configuration", "config", "Development", ".editorconfig .clang-format .clang-tidy .prettierrc .eslintrc .stylelintrc .babelrc .browserslistrc"],
    ["systemd", "SD", "systemd unit/config", "config", "Development", ".service .socket .device .mount .automount .swap .target .path .timer .slice .scope .network .netdev .link"],
    ["nix", "Nix", "Nix", "code", "Development", ".nix .flake.nix"],
    ["qml", "QML", "QML", "code", "Development", ".qml"],
    ["godot", "Godot", "Godot script / project", "code", "Development", ".gd .gdshader .godot"],
    ["c", "C", "C", "code", "Development", ".c"],
    ["cpp", "C++", "C++", "code", "Development", ".cpp .cc .cxx .c++ .hpp .hh .hxx .h++ .ipp .tpp .inl"],
    ["cheader", "H", "C/C++ header", "code", "Development", ".h"],
    ["objc", "ObjC", "Objective-C / Objective-C++", "code", "Development", ".m .mm"],
    ["swift", "Sw", "Swift", "code", "Development", ".swift"],
    ["java", "Java", "Java", "code", "Development", ".java"],
    ["kotlin", "Kt", "Kotlin", "code", "Development", ".kt .kts"],
    ["scala", "Sc", "Scala", "code", "Development", ".scala .sc"],
    ["groovy", "Gr", "Groovy", "code", "Development", ".groovy .gvy .gy .gsh"],
    ["csharp", "C#", "C#", "code", "Development", ".cs"],
    ["fsharp", "F#", "F#", "code", "Development", ".fs .fsi .fsx .fsscript"],
    ["visualbasic", "VB", "Visual Basic / VBScript", "code", "Development", ".vb .bas .cls .frm .vbs .vbe .wsc .wsf .hta"],
    ["javascript", "JS", "JavaScript", "code", "Development", ".js .mjs .cjs"],
    ["jsx", "JSX", "JSX", "code", "Development", ".jsx"],
    ["typescript", "TS", "TypeScript", "code", "Development", ".ts .mts .cts"],
    ["tsx", "TSX", "TSX", "code", "Development", ".tsx"],
    ["coffee", "Cof", "CoffeeScript", "code", "Development", ".coffee .litcoffee"],
    ["dart", "Dart", "Dart", "code", "Development", ".dart"],
    ["python", "Py", "Python / Cython / notebook", "code", "Development", ".py .pyi .pyw .pyx .pxd .pxi .ipynb"],
    ["ruby", "Rb", "Ruby / Ruby template", "code", "Development", ".rb .erb .haml .slim .rake .gemspec"],
    ["php", "PHP", "PHP", "code", "Development", ".php .phtml .php3 .php4 .php5 .phps .phar"],
    ["perl", "Perl", "Perl / POD", "code", "Development", ".pl .pm .t .pod"],
    ["raku", "Raku", "Raku", "code", "Development", ".raku .rakumod .rakutest"],
    ["lua", "Lua", "Lua / MoonScript", "code", "Development", ".lua .moon"],
    ["tcl", "Tcl", "Tcl / Tk / Expect", "code", "Development", ".tcl .tk .exp"],
    ["powershell", "PS", "PowerShell", "code", "Development", ".ps1 .psm1 .psd1 .ps1xml .psc1"],
    ["batch", "BAT", "Windows batch / command script", "code", "Development", ".bat .cmd .nt"],
    ["registry", "REG", "Windows registry / INF", "config", "Development", ".reg .inf"],
    ["autohotkey", "AHK", "AutoHotkey", "code", "Development", ".ahk"],
    ["autoit", "AU3", "AutoIt", "code", "Development", ".au3"],
    ["eiffel", "E", "Eiffel", "code", "Development", ".e"],
    ["elixir", "Ex", "Elixir", "code", "Development", ".ex .exs"],
    ["erlang", "Erl", "Erlang / yecc / leex", "code", "Development", ".erl .hrl .xrl .yrl .escript"],
    ["haskell", "Hs", "Haskell / Cabal", "code", "Development", ".hs .lhs .cabal"],
    ["elm", "Elm", "Elm", "code", "Development", ".elm"],
    ["purescript", "Pure", "PureScript", "code", "Development", ".purs"],
    ["reason", "Re", "Reason", "code", "Development", ".reason .rei"],
    ["rescript", "Res", "ReScript", "code", "Development", ".res .resi"],
    ["ocaml", "ML", "OCaml", "code", "Development", ".ml .mli .mll .mly"],
    ["clojure", "Clj", "Clojure / EDN", "code", "Development", ".clj .cljs .cljc .edn"],
    ["lisp", "Lisp", "Common Lisp", "code", "Development", ".lisp .lsp .fasl"],
    ["emacslisp", "El", "Emacs Lisp", "code", "Development", ".el"],
    ["scheme", "Scm", "Scheme", "code", "Development", ".scm .ss"],
    ["racket", "Rkt", "Racket", "code", "Development", ".rkt"],
    ["nim", "Nim", "Nim", "code", "Development", ".nim .nims"],
    ["crystal", "Cr", "Crystal", "code", "Development", ".cr"],
    ["go", "Go", "Go / Go module metadata", "code", "Development", ".go .mod .sum"],
    ["rust", "Rs", "Rust", "code", "Development", ".rs .rlib"],
    ["dlang", "D", "D", "code", "Development", ".d .di"],
    ["zig", "Zig", "Zig", "code", "Development", ".zig .zon"],
    ["vlang", "V", "V", "code", "Development", ".v .vsh"],
    ["odin", "Odin", "Odin", "code", "Development", ".odin"],
    ["jai", "Jai", "Jai", "code", "Development", ".jai"],
    ["carbon", "Cb", "Carbon", "code", "Development", ".carbon"],
    ["mojo", "Mojo", "Mojo", "code", "Development", ".mojo"],
    ["julia", "Jl", "Julia", "code", "Development", ".jl"],
    ["rstats", "R", "R / R Markdown", "code", "Development", ".r .rmd .rdata .rds .rda"],
    ["sas", "SAS", "SAS", "code", "Development", ".sas"],
    ["stata", "Stata", "Stata", "code", "Development", ".do .ado"],
    ["matlab", "MAT", "MATLAB / Simulink", "code", "Development", ".mat .slx .mdl .fig .mlx"],
    ["fortran", "F", "Fortran", "code", "Development", ".f .for .f77 .f90 .f95 .f03 .f08 .f15 .fpp"],
    ["cobol", "COB", "COBOL", "code", "Development", ".cob .cbl .cpy"],
    ["pascal", "Pas", "Pascal / Lazarus", "code", "Development", ".pas .pp .inc .lpr .lfm .lpi"],
    ["ada", "Ada", "Ada", "code", "Development", ".ada .adb .ads"],
    ["assembly", "Asm", "Assembly / preprocessed source", "code", "Development", ".asm .s .i .ii .nasm .a51 .8051"],
    ["cuda", "CUDA", "CUDA", "code", "Development", ".cu .cuh"],
    ["opencl", "OCL", "OpenCL", "code", "Development", ".cl"],
    ["glsl", "GLSL", "GLSL shader", "code", "Development", ".glsl .vert .frag .geom .tesc .tese .comp"],
    ["hlsl", "HLSL", "HLSL / DirectX shader", "code", "Development", ".hlsl .fx .fxh"],
    ["cg", "Cg", "Cg shader", "code", "Development", ".cg .cginc"],
    ["metal", "MTL", "Metal shader", "code", "Development", ".metal"],
    ["spirv", "SPV", "SPIR-V", "code", "Development", ".spv"],
    ["wgsl", "WGSL", "WGSL shader", "code", "Development", ".wgsl"],
    ["shader", "SHD", "Game / engine shader", "code", "Development", ".shader .usf .ush"],
    ["protobuf", "PB", "Protocol Buffers", "code", "Development", ".proto"],
    ["thrift", "Thr", "Apache Thrift", "code", "Development", ".thrift"],
    ["avro", "Avro", "Apache Avro schema", "code", "Development", ".avsc .avdl"],
    ["graphql", "GQL", "GraphQL", "code", "Development", ".graphql .gql"],
    ["solidity", "Sol", "Solidity", "code", "Development", ".sol"],
    ["move", "Move", "Move", "code", "Development", ".move"],
    ["cairo", "Cairo", "Cairo", "code", "Development", ".cairo"],
    ["vyper", "Vyp", "Vyper", "code", "Development", ".vy .vyi"],
    ["webassembly", "Wasm", "WebAssembly", "code", "Development", ".wat .wasm .wast"],
    ["bicep", "Bic", "Bicep", "code", "Development", ".bicep"],
    ["hcl", "HCL", "HCL / Terraform / Nomad", "code", "Development", ".hcl .tf .tfvars .nomad"],
    ["dockerfile", "Dkr", "Dockerfile", "code", "Development", ".dockerfile"],
    ["make", "Make", "Makefile", "code", "Development", ".makefile .mk"],
    ["autotools", "Auto", "GNU Autotools", "code", "Development", ".am .in .ac .m4"],
    ["cmake", "CMake", "CMake", "code", "Development", ".cmake"],
    ["qmake", "Qt", "qmake / Qbs", "code", "Development", ".pri .pro .qbs"],
    ["gradle", "Grad", "Gradle", "code", "Development", ".gradle"],
    ["sbt", "sbt", "sbt", "code", "Development", ".sbt"],
    ["maven", "Pom", "Maven POM", "code", "Development", ".pom"],
  ]);

  const SPECIAL_FILENAMES = new Map([
    ["cargo.lock", Object.freeze({"key": "rust", "glyph": "Rs", "label": "Rust Cargo lockfile", "family": "code", "category": "Development"})],
    ["cargo.toml", Object.freeze({"key": "rust", "glyph": "Rs", "label": "Rust Cargo manifest", "family": "code", "category": "Development"})],
    ["cmakelists.txt", Object.freeze({"key": "cmake", "glyph": "CMake", "label": "CMakeLists.txt", "family": "code", "category": "Development"})],
    ["containerfile", Object.freeze({"key": "dockerfile", "glyph": "Ctr", "label": "Containerfile", "family": "code", "category": "Development"})],
    ["dockerfile", Object.freeze({"key": "dockerfile", "glyph": "Dkr", "label": "Dockerfile", "family": "code", "category": "Development"})],
    ["gemfile", Object.freeze({"key": "ruby", "glyph": "Rb", "label": "Ruby Gemfile", "family": "code", "category": "Development"})],
    ["gnumakefile", Object.freeze({"key": "make", "glyph": "Make", "label": "GNU Makefile", "family": "code", "category": "Development"})],
    ["go.mod", Object.freeze({"key": "go", "glyph": "Go", "label": "Go module manifest", "family": "code", "category": "Development"})],
    ["go.sum", Object.freeze({"key": "go", "glyph": "Go", "label": "Go module checksums", "family": "code", "category": "Development"})],
    ["jenkinsfile", Object.freeze({"key": "jenkins", "glyph": "Jnk", "label": "Jenkinsfile", "family": "config", "category": "Development"})],
    ["makefile", Object.freeze({"key": "make", "glyph": "Make", "label": "Makefile", "family": "code", "category": "Development"})],
    ["package-lock.json", Object.freeze({"key": "javascript", "glyph": "JS", "label": "npm lockfile", "family": "code", "category": "Development"})],
    ["package.json", Object.freeze({"key": "javascript", "glyph": "JS", "label": "Node package manifest", "family": "code", "category": "Development"})],
    ["procfile", Object.freeze({"key": "procfile", "glyph": "Proc", "label": "Procfile", "family": "config", "category": "Development"})],
    ["pyproject.toml", Object.freeze({"key": "python", "glyph": "Py", "label": "Python project configuration", "family": "code", "category": "Development"})],
    ["rakefile", Object.freeze({"key": "ruby", "glyph": "Rb", "label": "Ruby Rakefile", "family": "code", "category": "Development"})],
    ["requirements.txt", Object.freeze({"key": "python", "glyph": "Py", "label": "Python requirements", "family": "code", "category": "Development"})],
    ["tsconfig.json", Object.freeze({"key": "typescript", "glyph": "TS", "label": "TypeScript configuration", "family": "code", "category": "Development"})],
    ["vagrantfile", Object.freeze({"key": "vagrant", "glyph": "Vag", "label": "Vagrantfile", "family": "config", "category": "Development"})],
  ]);

  const TYPE_HINTS = Object.freeze({
    "elf": Object.freeze({"key": "elf", "glyph": "ELF", "label": "ELF executable", "family": "executable", "category": "Executables"}),
    "pe-executable": Object.freeze({"key": "pe", "glyph": "EXE", "label": "Windows PE executable", "family": "executable", "category": "Executables"}),
    "mach-o": Object.freeze({"key": "macho", "glyph": "Mach", "label": "Mach-O executable", "family": "executable", "category": "Executables"}),
    "executable": Object.freeze({"key": "executable", "glyph": "EXE", "label": "Executable file", "family": "executable", "category": "Executables"}),
    "script-shell": Object.freeze({"key": "shell", "glyph": "Sh", "label": "Shell script", "family": "code", "category": "Development"}),
    "code-python": Object.freeze({"key": "python", "glyph": "Py", "label": "Python script", "family": "code", "category": "Development"}),
    "code-javascript": Object.freeze({"key": "javascript", "glyph": "JS", "label": "JavaScript script", "family": "code", "category": "Development"}),
    "code-typescript": Object.freeze({"key": "typescript", "glyph": "TS", "label": "TypeScript script", "family": "code", "category": "Development"}),
    "code-ruby": Object.freeze({"key": "ruby", "glyph": "Rb", "label": "Ruby script", "family": "code", "category": "Development"}),
    "code-perl": Object.freeze({"key": "perl", "glyph": "Perl", "label": "Perl script", "family": "code", "category": "Development"}),
    "code-php": Object.freeze({"key": "php", "glyph": "PHP", "label": "PHP script", "family": "code", "category": "Development"}),
    "code-lua": Object.freeze({"key": "lua", "glyph": "Lua", "label": "Lua script", "family": "code", "category": "Development"}),
    "code-powershell": Object.freeze({"key": "powershell", "glyph": "PS", "label": "PowerShell script", "family": "code", "category": "Development"}),
    "code-awk": Object.freeze({"key": "awk", "glyph": "Awk", "label": "AWK script", "family": "code", "category": "Development"}),
    "makefile": Object.freeze({"key": "make", "glyph": "Make", "label": "Makefile", "family": "code", "category": "Development"}),
    "dockerfile": Object.freeze({"key": "dockerfile", "glyph": "Dkr", "label": "Dockerfile / Containerfile", "family": "code", "category": "Development"}),
    "cmake": Object.freeze({"key": "cmake", "glyph": "CMake", "label": "CMake file", "family": "code", "category": "Development"}),
    "config": Object.freeze({"key": "config", "glyph": "CFG", "label": "Configuration file", "family": "config", "category": "Development"}),
    "text": Object.freeze({"key": "text", "glyph": "TXT", "label": "Text file", "family": "text", "category": "Documents"}),
    "binary": Object.freeze({"key": "binary", "glyph": "BIN", "label": "Binary data", "family": "binary", "category": "Other"}),
    "pdf": Object.freeze({"key": "pdf", "glyph": "PDF", "label": "PDF document", "family": "document", "category": "Documents"}),
    "image-png": Object.freeze({"key": "png", "glyph": "PNG", "label": "PNG image", "family": "image", "category": "Images"}),
    "image-jpeg": Object.freeze({"key": "jpeg", "glyph": "JPG", "label": "JPEG image", "family": "image", "category": "Images"}),
    "image-gif": Object.freeze({"key": "gif", "glyph": "GIF", "label": "GIF image", "family": "image", "category": "Images"}),
    "image-webp": Object.freeze({"key": "webp", "glyph": "WEBP", "label": "WebP image", "family": "image", "category": "Images"}),
    "archive-zip": Object.freeze({"key": "zip", "glyph": "ZIP", "label": "ZIP-compatible archive", "family": "archive", "category": "Archives"}),
    "archive-7z": Object.freeze({"key": "7z", "glyph": "7Z", "label": "7-Zip archive", "family": "archive", "category": "Archives"}),
    "archive-rar": Object.freeze({"key": "rar", "glyph": "RAR", "label": "RAR archive", "family": "archive", "category": "Archives"}),
    "archive-gzip": Object.freeze({"key": "gzip", "glyph": "GZ", "label": "Gzip-compressed file", "family": "archive", "category": "Archives"}),
    "archive-bzip2": Object.freeze({"key": "bzip2", "glyph": "BZ2", "label": "Bzip2-compressed file", "family": "archive", "category": "Archives"}),
    "archive-xz": Object.freeze({"key": "xz", "glyph": "XZ", "label": "XZ-compressed file", "family": "archive", "category": "Archives"}),
    "archive-zstd": Object.freeze({"key": "zstd", "glyph": "ZST", "label": "Zstandard-compressed file", "family": "archive", "category": "Archives"}),
    "audio-flac": Object.freeze({"key": "flac", "glyph": "FLAC", "label": "FLAC audio", "family": "audio", "category": "Audio"}),
    "audio-ogg": Object.freeze({"key": "ogg", "glyph": "OGG", "label": "Ogg media", "family": "audio", "category": "Audio"}),
    "audio-wave": Object.freeze({"key": "wave", "glyph": "WAV", "label": "WAVE audio", "family": "audio", "category": "Audio"}),
    "video-avi": Object.freeze({"key": "avi", "glyph": "AVI", "label": "AVI video", "family": "video", "category": "Video"}),
    "video-matroska": Object.freeze({"key": "matroska", "glyph": "MKV", "label": "Matroska / WebM media", "family": "video", "category": "Video"}),
    "sqlite": Object.freeze({"key": "sqlite", "glyph": "DB", "label": "SQLite database", "family": "database", "category": "Data / game assets"}),
  });


  const normalizeExtension = value => {
    const text = String(value || '').trim().toLowerCase();
    if (!text || text === '(none)') return '';
    return text.startsWith('.') ? text : `.${text}`;
  };

  const generic = new Map();
  const categoryExtensions = new Map();
  const allKnown = new Set();
  const wildcard = [];
  const wildcardTokens = new Map();
  for (const [section, family, glyph, label, category, packed] of SECTION_GROUPS) {
    for (const token of packed.split(/\s+/).filter(Boolean)) {
      const extension = normalizeExtension(token);
      if (!extension) continue;
      allKnown.add(extension);
      if (extension.includes('*')) {
        const escaped = extension.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.+');
        const descriptor = Object.freeze({ key: family, glyph, label, family, category, section });
        wildcard.push([new RegExp(`${escaped}$`, 'i'), descriptor, extension]);
        wildcardTokens.set(extension, descriptor);
        continue;
      }
      if (!generic.has(extension)) generic.set(extension, Object.freeze({ key: family, glyph, label, family, category, section }));
      if (!categoryExtensions.has(category)) categoryExtensions.set(category, []);
      categoryExtensions.get(category).push(extension);
    }
  }

  const specific = new Map();
  for (const [key, glyph, label, family, category, packed] of SPECIFIC_GROUPS) {
    for (const token of packed.split(/\s+/).filter(Boolean)) {
      const extension = normalizeExtension(token);
      specific.set(extension, Object.freeze({ key, glyph, label, family, category }));
      allKnown.add(extension);
    }
  }

  // Reversed suffix trie: compound extensions such as .tar.zst,
  // .pkg.tar.zst, .synctex.gz, .blade.php and .user.js resolve in O(name length).
  const suffixRoot = Object.create(null);
  for (const extension of allKnown) {
    if (!extension || extension.includes('*')) continue;
    let node = suffixRoot;
    for (let index = extension.length - 1; index >= 0; index -= 1) {
      const char = extension[index];
      node[char] ||= Object.create(null);
      node = node[char];
    }
    node.$ = extension;
  }

  function extensionForName(name, fallback = '') {
    const lower = String(name || '').toLowerCase();
    for (const [pattern,, token] of wildcard) if (pattern.test(lower)) return token;
    let trie = suffixRoot;
    let best = '';
    for (let index = lower.length - 1; index >= 0; index -= 1) {
      trie = trie[lower[index]];
      if (!trie) break;
      if (trie.$) best = trie.$;
    }
    return best || normalizeExtension(fallback);
  }

  function descriptorForExtension(extension) {
    const normalized = normalizeExtension(extension);
    return specific.get(normalized) || generic.get(normalized) || wildcardTokens.get(normalized) || null;
  }

  function descriptorForNode(node) {
    if (!node) return null;
    const lowerName = String(node.name || '').toLowerCase();
    if (SPECIAL_FILENAMES.has(lowerName)) return SPECIAL_FILENAMES.get(lowerName);
    const hint = String(node.type_hint || '');
    if (hint && TYPE_HINTS[hint]) return TYPE_HINTS[hint];
    return descriptorForExtension(extensionForName(node.name, node.extension));
  }

  function categoryForNode(node) {
    return descriptorForNode(node)?.category || null;
  }

  function labelForNode(node) {
    const descriptor = descriptorForNode(node);
    if (descriptor) return descriptor.label;
    return extensionForName(node?.name, node?.extension) || node?.kind || 'File';
  }

  // Primary category coverage uses the final descriptor precedence (specific
  // language/tool mappings first, then the first matching generic family).
  const categoryObject = {};
  for (const extension of allKnown) {
    const descriptor = descriptorForExtension(extension);
    if (!descriptor?.category) continue;
    categoryObject[descriptor.category] ||= [];
    categoryObject[descriptor.category].push(extension);
  }
  for (const category of Object.keys(categoryObject)) {
    categoryObject[category] = Object.freeze([...new Set(categoryObject[category])]);
  }

  window.DiskMosaicFileTypes = Object.freeze({
    descriptorForNode,
    descriptorForExtension,
    extensionForName,
    categoryForNode,
    labelForNode,
    normalizeExtension,
    categoryExtensions: Object.freeze(categoryObject),
    recognizedExtensionCount: allKnown.size,
    sourceExtensionCount: 240,
  });
})();
