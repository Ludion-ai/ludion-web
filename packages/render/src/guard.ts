// 枠の中で、外へ通信できる WebRTC を使えなくする（FRAME002。docs の AUDIT001 F1）。
//
// 枠の CSP（FRAME_CSP の default-src 'none'）は、fetch、WebSocket、画像などを止める。けれど WebRTC は CSP の対象ではない。
// そこで、作品のどのスクリプトよりも先に（STORAGE_SCRIPT より前）、次をする：
//
// 1. window から、RTC で始まる名前（RTCPeerConnection、webkitRTCPeerConnection、RTCDataChannel など）を消す。
//    名前は決め打ちにせず、その時のブラウザの window にある物を全部消す（新しい名前が増えても効く）。
// 2. 作品の中で、入れ子の枠（iframe、frame、object、embed など）を作れないようにする。
//    入れ子の枠には新しい window ができ、そこには 1 で消していない WebRTC があるため。
//    Ludion の作品は CSP で外の物を読めないので、入れ子の枠は役に立たない（works/ と fixtures/works/ は使っていない）。
//    作る道（createElement、innerHTML などの文字、ノードの差し込み）で、入れ子の枠が入っていれば、入れる前に投げる。
// 3. それでも文書の文字として書かれて現れた入れ子の枠は、見つけしだい外す（MutationObserver。次のスクリプトより前に動く）。
//    文書を読み終えたら（DOMContentLoaded）見張りをやめる。その後に入る物は、2 の道を通るため（ふだんの DOM の操作を重くしない）。
//
// これは守りの1枚。置く時の検査（packages/rules）、審査、リンクで見せる時の確かめと重ねて使う。
// 文書の文字として書かれた入れ子の枠の、ごく一部の書き方は、3 の前に動きうる。それは置く時の検査で止める。
// 作品の書き方の決まり：「入れ子の枠と WebRTC は使わない」。
// 差し替えた関数は消せない（configurable: false）。上書きの代入はできる（古い書き方の補いの代入で作品が止まらないように）。
// 上書きしても、元の関数はこの中にしか残っていないので、守りは外れない。
//
// 文字のまま枠に入れるので、TypeScript ではなく、そのまま動く JS の文字列で書く。

/** 作品の中で作れない入れ子の枠の要素（小文字のタグの名前） */
export const NESTED_FRAME_TAGS = ['iframe', 'frame', 'frameset', 'object', 'embed', 'portal', 'fencedframe'] as const;

/** 使えなくする window の名前の形 */
export const WEBRTC_NAME = /^(?:webkit|moz)?RTC/;

export const FRAME_GUARD_SCRIPT = `(()=>{try{
const W=window,D=document,O=Object;
for(const n of O.getOwnPropertyNames(W)){if(!${WEBRTC_NAME}.test(n))continue;try{delete W[n]}catch(e){}try{O.defineProperty(W,n,{value:undefined,writable:false,enumerable:false,configurable:false})}catch(e){}}
const TAGS=${JSON.stringify(NESTED_FRAME_TAGS)};
const SEL=TAGS.join(",");
const RE=/<(?:${NESTED_FRAME_TAGS.join('|')})(?=[\\s/>])/i;
const no=()=>{throw new DOMException("Nested frames are not available in a Ludion work.","NotSupportedError")};
const badText=(v)=>RE.test(String(v));
const badNode=(n)=>{if(!n||typeof n!=="object"||typeof n.nodeType!=="number")return false;
if(n.nodeType===1){if(TAGS.includes(n.localName))return true;if(n.firstElementChild&&n.querySelector(SEL))return true;if(n.shadowRoot&&badNode(n.shadowRoot))return true;return false}
if(n.nodeType===11||n.nodeType===9){return !!(n.firstElementChild&&n.querySelector(SEL))}
return false};
const lock=(proto,name,make)=>{if(!proto)return;const d=O.getOwnPropertyDescriptor(proto,name);if(!d)return;const next=make(d);if(next)O.defineProperty(proto,name,{...next,enumerable:d.enumerable,configurable:false})};
const method=(proto,name,check)=>lock(proto,name,(d)=>typeof d.value==="function"&&{value:function(...a){check(a);return d.value.apply(this,a)},writable:true});
const setter=(proto,name)=>lock(proto,name,(d)=>d.set&&{get:d.get,set:function(v){if(badText(v))no();return d.set.call(this,v)}});
const nodes=(a)=>{for(const n of a)if(badNode(n))no()};
const first=(a)=>{if(badNode(a[0]))no()};
const tag=(v)=>TAGS.includes(String(v).toLowerCase().split(":").pop());
method(Document.prototype,"createElement",(a)=>{if(tag(a[0]))no()});
method(Document.prototype,"createElementNS",(a)=>{if(tag(a[1]))no()});
for(const name of ["appendChild","insertBefore","replaceChild"])method(Node.prototype,name,first);
for(const P of [Element,Document,DocumentFragment,CharacterData,DocumentType])for(const name of ["append","prepend","replaceChildren","before","after","replaceWith"])method(P.prototype,name,nodes);
method(Element.prototype,"insertAdjacentElement",(a)=>{if(badNode(a[1]))no()});
method(Element.prototype,"insertAdjacentHTML",(a)=>{if(badText(a[1]))no()});
for(const P of [Element,ShadowRoot]){setter(P.prototype,"innerHTML");method(P.prototype,"setHTMLUnsafe",(a)=>{if(badText(a[0]))no()});method(P.prototype,"setHTML",(a)=>{if(badText(a[0]))no()})}
setter(Element.prototype,"outerHTML");
for(const name of ["write","writeln"])method(Document.prototype,name,(a)=>{if(badText(a.join("")))no()});
method(Document.prototype,"execCommand",(a)=>{if(badText(a[2]))no()});
if(typeof Document.parseHTMLUnsafe==="function")lock(Document,"parseHTMLUnsafe",(d)=>({value:function(...a){if(badText(a[0]))no();return d.value.apply(this,a)},writable:true}));
if(typeof DOMParser==="function")method(DOMParser.prototype,"parseFromString",(a)=>{if(badText(a[0]))no()});
method(Range.prototype,"createContextualFragment",(a)=>{if(badText(a[0]))no()});
for(const name of ["insertNode","surroundContents"])method(Range.prototype,name,first);
const drop=(root)=>{if(!root||!root.querySelectorAll)return;for(const el of root.querySelectorAll(SEL))el.remove()};
const seen=new WeakSet();let parsed=false;
const watch=(root)=>{if(!root||seen.has(root))return;seen.add(root);drop(root);if(!parsed)observer.observe(root,{childList:true,subtree:true})};
const look=(n)=>{if(!n||n.nodeType!==1)return;if(TAGS.includes(n.localName)){n.remove();return}if(n.firstElementChild)drop(n);if(n.shadowRoot)watch(n.shadowRoot)};
const observer=new MutationObserver((list)=>{for(const m of list)for(const n of m.addedNodes)look(n)});
lock(Element.prototype,"attachShadow",(d)=>typeof d.value==="function"&&{value:function(...a){const r=d.value.apply(this,a);watch(r);return r},writable:true});
watch(D);
D.addEventListener("DOMContentLoaded",()=>{for(const m of observer.takeRecords())for(const n of m.addedNodes)look(n);observer.disconnect();parsed=true},{once:true});
}catch(e){}})();`;
