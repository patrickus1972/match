#!/bin/sh
# Bundles index.html + styles.css + app.js into one self-contained file.
# Run from this directory: sh build.sh
python3 - <<'PY'
h = open('index.html').read()
css = open('styles.css').read()
js  = open('app.js').read()
h = h.replace('<link rel="stylesheet" href="styles.css">', '<style>\n' + css + '\n</style>')
h = h.replace('<script src="app.js"></script>', '<script>\n' + js + '\n</script>')
open('prototype.html', 'w').write(h)
print('prototype.html written —', len(h), 'bytes')
PY
