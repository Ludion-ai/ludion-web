// 枠の中の localStorage、sessionStorage、document.cookie（FRAME001）。
//
// 枠は allow-same-origin のない sandbox なので、オリジンがない。本物の storage と cookie は、読んだだけで SecurityError を投げる。
// これは守りのために正しいが、AI が書く HTML の多くは、読み込みで localStorage を読む。投げると、その作品は最初から動かない。
// そこで、作品のどのスクリプトよりも先に、メモリだけの代わりを置く。
//
// - 本物が使えるか試し、投げるときだけ差し替える（window と document に定義する。本物は window の自分の属性と Document.prototype にある）。
// - Storage の形を全部持つ：getItem、setItem、removeItem、clear、key、length。値は文字列にする。
//   localStorage.foo = 'x'、localStorage['foo']、delete、in、Object.keys も効く（Proxy）。instanceof Storage も true。
// - 上限は本物に合わせて 5MB（鍵と値の文字数の和、5 × 1024 × 1024）。超えたら QuotaExceededError を投げる。
// - 保存はしない。読み直すと消える。親のページに預けない（ludion.ai のオリジンに作品のデータを置かないため）。
// - 外とは何もやりとりしない。枠の CSP は変えない（script-src 'unsafe-inline' の中の、Ludion のスクリプト）。
// - indexedDB は触らない。
//
// 文字のまま枠に入れるので、ここは TypeScript ではなく、そのまま動く JS の文字列で書く。

/** メモリだけの storage の上限（文字数）。本物の Chromium、WebKit、Firefox と同じ */
export const MEMORY_STORAGE_LIMIT = 5 * 1024 * 1024;

export const STORAGE_SCRIPT = `(()=>{try{
const LIMIT=${MEMORY_STORAGE_LIMIT};
const has=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const need=(args,n,name)=>{if(args.length<n)throw new TypeError("Failed to execute '"+name+"' on 'Storage': "+n+" argument"+(n>1?"s":"")+" required, but only "+args.length+" present.")};
const quota=()=>{const m="Setting the value exceeded the quota.";return typeof QuotaExceededError==="function"?new QuotaExceededError(m):new DOMException(m,"QuotaExceededError")};
const memory=()=>{
const items=new Map();let used=0;
const size=(k)=>items.has(k)?k.length+items.get(k).length:0;
const api={
getItem(k){need(arguments,1,"getItem");k=String(k);return items.has(k)?items.get(k):null},
setItem(k,v){need(arguments,2,"setItem");k=String(k);v=String(v);const next=used-size(k)+k.length+v.length;if(next>LIMIT)throw quota();items.set(k,v);used=next},
removeItem(k){need(arguments,1,"removeItem");k=String(k);used-=size(k);items.delete(k)},
clear(){items.clear();used=0},
key(i){need(arguments,1,"key");i=Number(i)>>>0;return i<items.size?[...items.keys()][i]:null}
};
const target=Object.create(typeof Storage==="function"?Storage.prototype:Object.prototype);
return new Proxy(target,{
get(t,p){if(typeof p==="string"){if(p==="length")return items.size;if(has(api,p))return api[p];if(!(p in t))return items.has(p)?items.get(p):undefined}return Reflect.get(t,p)},
set(t,p,v){if(typeof p!=="string")return Reflect.set(t,p,v);api.setItem(p,v);return true},
has(t,p){return typeof p==="string"&&items.has(p)||p in t},
deleteProperty(t,p){if(typeof p==="string")api.removeItem(p);return true},
ownKeys(){return[...items.keys()]},
getOwnPropertyDescriptor(t,p){if(typeof p==="string"&&items.has(p))return{value:items.get(p),writable:true,enumerable:true,configurable:true};return undefined},
defineProperty(t,p,d){if(typeof p!=="string"||!("value" in d))return false;api.setItem(p,d.value);return true}
});
};
for(const name of ["localStorage","sessionStorage"]){
let works=false;try{works=typeof window[name].length==="number"}catch(e){}
if(works)continue;
const store=memory();
Object.defineProperty(window,name,{get:()=>store,set(){},enumerable:true,configurable:true});
}
let cookieWorks=false;try{cookieWorks=typeof document.cookie==="string"}catch(e){}
if(!cookieWorks){
const jar=new Map();
Object.defineProperty(document,"cookie",{
get(){return[...jar].map(([k,v])=>k===""?v:k+"="+v).join("; ")},
set(text){
const parts=String(text).split(";");const pair=parts.shift();const i=pair.indexOf("=");
const name=(i<0?"":pair.slice(0,i)).trim();const value=(i<0?pair:pair.slice(i+1)).trim();
if(name===""&&value===""||name.length+value.length>4096)return;
let gone=false;
for(const a of parts){const j=a.indexOf("=");const key=(j<0?a:a.slice(0,j)).trim().toLowerCase();const val=j<0?"":a.slice(j+1).trim();
if(key==="max-age"&&/^-?\\d+$/.test(val)&&Number(val)<=0)gone=true;
if(key==="expires"){const at=Date.parse(val);if(!Number.isNaN(at)&&at<=Date.now())gone=true}}
if(gone)jar.delete(name);else jar.set(name,value)
},
enumerable:true,configurable:true});
}
}catch(e){}})();`;
