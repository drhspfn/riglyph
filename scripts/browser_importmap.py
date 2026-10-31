"""Pure local test utility: map built ESM package modules to data URLs for Chromium.
No external routes or dependency downloads are used. Not part of runtime.
"""
from pathlib import Path
import base64,re

def map_modules(root:Path,names:tuple[str,...]|list[str]):
 mapping={}
 for name in names:
  dist=root/'packages'/name/'dist'
  for path in dist.rglob('*'):
   if path.suffix not in ('.js','.json'):continue
   key='universal/'+name+'/'+path.relative_to(dist).as_posix()
   if path.suffix=='.json':
    url='data:application/json;base64,'+base64.b64encode(path.read_bytes()).decode()
   else:
    content=path.read_text()
    def replace(m):
     spec=m.group(2)
     if spec.startswith('@riglyph/'):
      dst='universal/'+spec.split('/')[1]+'/index.js'
     elif spec.startswith('.'):
      resolved=(path.parent/spec).resolve()
      dst='universal/'+name+'/'+resolved.relative_to(dist.resolve()).as_posix()
     else:return m.group(0)
     return m.group(1)+dst+m.group(3)
    content=re.sub(r"((?:\bfrom\s*|\bimport\s*|\bimport\s*\()\s*['\"])([^'\"]+)(['\"])",replace,content)
    url='data:text/javascript;base64,'+base64.b64encode(content.encode()).decode()
   mapping[key]=url
 return mapping
