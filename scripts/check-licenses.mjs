import { readFileSync } from 'node:fs';
const lock=JSON.parse(readFileSync('package-lock.json','utf8'));
const reviewed=new Set(['MIT','BlueOak-1.0.0','ISC','MIT OR Apache-2.0','MIT-0','Apache-2.0','LGPL-3.0-or-later','Apache-2.0 AND LGPL-3.0-or-later AND MIT','Apache-2.0 AND LGPL-3.0-or-later','BSD-2-Clause','MPL-2.0','0BSD','BSD-3-Clause','Python-2.0','CC-BY-4.0','BSD','(MIT OR WTFPL)','Unlicense','(MIT OR GPL-3.0-or-later)','CC0-1.0','(MIT AND Zlib)','Zlib','(BSD-2-Clause OR MIT OR Apache-2.0)']);
for(const [path,pkg] of Object.entries(lock.packages)){
  if(!path)continue;
  if(reviewed.has(pkg.license))continue;
  if(path==='node_modules/gsap'&&pkg.license?.includes('gsap.com/standard-license'))continue;
  if(path==='node_modules/mapbox-gl'&&pkg.license==='SEE LICENSE IN LICENSE.txt')continue;
  if(path==='node_modules/webgl-constants'&&pkg.version==='1.1.1'&&readFileSync(path+'/LICENSE','utf8').startsWith('MIT License'))continue;
  throw new Error(`Unreviewed license: ${path}: ${pkg.license}`);
}
console.log('Dependency licenses match reviewed dispositions in THIRD_PARTY_NOTICES.md.');
