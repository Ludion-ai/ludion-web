// part.js — ESモジュール。rootの中だけを触る
// プリズムのタブ：4つの切り替え。選ばれた項目の下に、逆三角のガラスが置いてある。
//
// 光学：断面は頂角70°の逆三角で、足だけ平らに切ってある。横から来た光は腹の面で曲がり、
//       反対の腹で全反射して、上面からほぼ真上へ出る。左右どちらから来ても同じ道を鏡に写して通る。
//       屈折率を波長ごとに変えて道を計算するので、ガラスの中で白い線が少しずつ分かれる。
// 描画：HDR の面に部屋（壁、机、文字、虹、光の筋）を解析的に描き、次にガラスだけを別の短いパスで光線追跡する。
//       ガラスから出た光線は、部屋を描いた面を引く。最後に光のにじみを足して、8bit へ落とす。
// 色  ：JS に色を書かない。--_bg、--_surface、--_fg、--_muted は線形の値にして使う。
//       虹は --_accent の色相を回して作り、白はその虹を全部足して作る。

const CELLS = 4;

// ---- 世界。単位は「1項目の幅」。壁は z=0、机は y=0、手前が +z
const PA = 0.355; // 上面の半分の幅
const PF = 0.045; // 足の半分の幅
const APEX = (70 * Math.PI) / 180;
const PH = (PA - PF) / Math.tan(APEX / 2); // 高さ
const ZB = 0.06; // 奥の面
const ZF = 0.44; // 手前の面（上の辺）
const TILT = (16 * Math.PI) / 180; // 手前の面は宝石のように上を向く
const ZM = 0.25; // 光の通る面
const BEAM_Y = 0.095; // 光の高さ
const LABEL_Y = 0.98; // 文字の中心の高さ
const GLYPH_S = 0.62; // 文字の枠の大きさ
const CAM = [0, 1.7, 6];
const TURN = (275 * Math.PI) / 180; // 虹の色相の幅
const REST_BEAM = 0.2; // 残光の強さ
const REST_FAN = 0.16;

const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const mix = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const f = (v) => v.toFixed(6);

// ---- 色の計算
const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
function linearToOklab([r, g, b]) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
function oklabToLinear(L, a, b) {
  const l = Math.pow(L + 0.3963377774 * a + 0.2158037573 * b, 3);
  const m = Math.pow(L - 0.1055613458 * a - 0.0638541728 * b, 3);
  const s = Math.pow(L - 0.0894841775 * a - 1.291485548 * b, 3);
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
}
// 色相と鮮やかさと明るさから、色域に入る線形の色を作る
function hueTone(h, C, L) {
  let chroma = C;
  for (let i = 0; i < 24; i++) {
    const rgb = oklabToLinear(L, Math.cos(h) * chroma, Math.sin(h) * chroma);
    if (rgb.every((v) => v >= 0 && v <= 1)) return rgb;
    chroma *= 0.93;
  }
  return oklabToLinear(L, 0, 0).map((v) => clamp(v));
}
const luminance = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

// ---- 光の道：左から来た水平な光を、屈折率 n で追う（断面の2次元）
function refract2(i, n, eta) {
  const c = i[0] * n[0] + i[1] * n[1];
  const k = 1 - eta * eta * (1 - c * c);
  if (k < 0) return null;
  const t = eta * c + Math.sqrt(k);
  return [eta * i[0] - t * n[0], eta * i[1] - t * n[1]];
}
const BELLY_LEN = Math.hypot(PH, PA - PF);
const N_RIGHT = [PH / BELLY_LEN, -(PA - PF) / BELLY_LEN];
const N_LEFT = [-N_RIGHT[0], N_RIGHT[1]];
function tracePath(n) {
  const E = [-(PF + ((PA - PF) * BEAM_Y) / PH), BEAM_Y];
  const d1 = refract2([1, 0], N_LEFT, 1 / n);
  const plane = PF * N_RIGHT[0];
  const s = (plane - (E[0] * N_RIGHT[0] + E[1] * N_RIGHT[1])) / (d1[0] * N_RIGHT[0] + d1[1] * N_RIGHT[1]);
  const T = [E[0] + d1[0] * s, E[1] + d1[1] * s];
  const dn = d1[0] * N_RIGHT[0] + d1[1] * N_RIGHT[1];
  const d2 = [d1[0] - 2 * dn * N_RIGHT[0], d1[1] - 2 * dn * N_RIGHT[1]];
  const s2 = (PH - T[1]) / d2[1];
  const X = [T[0] + d2[0] * s2, PH];
  const d3 = refract2(d2, [0, -1], n) ?? d2;
  // 上面の内側で弱く跳ね返り、腹まで届く光
  const d4 = [d2[0], -d2[1]];
  let reach = 1e6;
  for (const normal of [N_LEFT, N_RIGHT]) {
    const dn4 = d4[0] * normal[0] + d4[1] * normal[1];
    if (dn4 > 1e-5) reach = Math.min(reach, (plane - (X[0] * normal[0] + X[1] * normal[1])) / dn4);
  }
  const G = [X[0] + d4[0] * reach, X[1] + d4[1] * reach];
  return { E, T, X, G, angle: Math.atan2(d3[0], d3[1]) };
}
const IOR = [0, 1, 2, 3, 4].map((k) => 1.47 + 0.3 * ((k + 0.5) / 5));
const ENV_IOR = [0, 1, 2, 3, 4].map((k) => 1.585 + 0.05 * ((k + 0.5) / 5));
const PATHS = IOR.map(tracePath);
const MEAN_PATH = tracePath(IOR[2]);
const LEAN = MEAN_PATH.angle; // 左から来たとき、虹が傾く角（真上が 0）
const XOUT = MEAN_PATH.X[0]; // 上面から出る場所
const BEAM_ENTRY = MEAN_PATH.E[0];
// ---- シェーダー
const VERT = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main(){
  vUv=aPos*.5+.5;
  gl_Position=vec4(aPos,0.,1.);
}`;

// 1枚の面に、壁の細かな凹凸を焼いておく。繰り返しても継ぎ目が出ない周期のノイズ
const BAKE = `#version 300 es
precision highp float;
precision highp int;
in vec2 vUv;
out vec4 O;
float hash(ivec2 p,int s){
  uint x=uint(p.x)*1597334677u^uint(p.y)*3812015801u^uint(s)*2798796415u;
  x^=x>>16;x*=2246822519u;x^=x>>13;x*=3266489917u;x^=x>>16;
  return float(x)/4294967295.;
}
vec2 grad(ivec2 p,int per,int s){
  p=ivec2(mod(vec2(p),float(per)));
  float a=6.2831853*hash(p,s);
  return vec2(cos(a),sin(a));
}
float pn(vec2 x,int per,int s){
  vec2 fl=floor(x);
  ivec2 i=ivec2(fl);
  vec2 g=x-fl;
  vec2 u=g*g*g*(g*(g*6.-15.)+10.);
  float a=dot(grad(i,per,s),g);
  float b=dot(grad(i+ivec2(1,0),per,s),g-vec2(1.,0.));
  float c=dot(grad(i+ivec2(0,1),per,s),g-vec2(0.,1.));
  float d=dot(grad(i+ivec2(1,1),per,s),g-vec2(1.,1.));
  return mix(mix(a,b,u.x),mix(c,d,u.x),u.y);
}
float relief(vec2 uv){
  float h=0.,a=.5;
  int per=64;
  for(int i=0;i<4;i++){
    h+=a*pn(uv*float(per),per,i+1);
    per*=2;
    a*=.72;
  }
  return h;
}
void main(){
  float e=1./1024.;
  float h=relief(vUv);
  vec2 n=vec2(h-relief(vUv+vec2(e,0.)),h-relief(vUv+vec2(0.,e)))*14.;
  float low=0.,a=.6;
  int per=3;
  for(int i=0;i<4;i++){
    low+=a*pn(vUv*float(per),per,i+17);
    per*=2;
    a*=.55;
  }
  O=vec4(clamp(n*.5+.5,0.,1.),clamp(low*.9+.5,0.,1.),clamp(h*1.1+.5,0.,1.));
}`;

const headFor = (floatOK) => `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
const float PA=${f(PA)},PF=${f(PF)},PH=${f(PH)},ZB=${f(ZB)},ZF=${f(ZF)},ZM=${f(ZM)};
const float BEAM_Y=${f(BEAM_Y)},LABEL_Y=${f(LABEL_Y)},GLYPH_S=${f(GLYPH_S)};
float sat(float x){return clamp(x,0.,1.);}
float dot2(vec2 v){return dot(v,v);}
float lumOf(vec3 c){return dot(c,vec3(.2126,.7152,.0722));}
float softBox(vec2 p,vec2 hs,float e){
  vec2 d=abs(p)-hs;
  return (1.-smoothstep(-e,e,d.x))*(1.-smoothstep(-e,e,d.y));
}
vec3 enc(vec3 c){return ${floatOK ? 'c' : 'sqrt(max(c,vec3(0.))/8.)'};}
vec3 dec(vec3 c){return ${floatOK ? 'c' : 'c*c*8.'};}
`;

// 虹：壁にも空気にも、ガラスの手前にも同じ式で描く
const FAN_GLSL = `uniform vec4 uFanA[2],uFanB[2];
uniform vec3 uFanC[2];
uniform vec4 uVig;
uniform float uTime;
// 虹：扇の面の上の場所から、届く光を求める
vec3 fanField(vec2 p,vec4 A,vec4 B,vec3 C,float soft){
  if(B.x<=.0005) return vec3(0.);
  vec2 d=p-A.xy;
  if(d.y<=0.) return vec3(0.);
  float r=length(d);
  float ang=atan(d.x,d.y)-A.z;
  float tt=ang/A.w;
  float aa=soft/(r*A.w)+.015;
  float at=abs(tt);
  if(at>1.+aa*2.) return vec3(0.);
  float win=1.-smoothstep(.62-aa,1.+aa,at);
  win*=1.-.28*at*at;
  float rr=r-C.x;
  float rev=1.-smoothstep(B.y-.55,B.y,rr);
  if(rev<=0.) return vec3(0.);
  float start=smoothstep(PH-soft,PH+.01+soft,p.y)*(1.-smoothstep(uVig.y+uVig.w-.95,uVig.y+uVig.w-.12,p.y));
  float t=clamp(.5+.5*tt*B.z,0.,1.);
  vec3 c=textureLod(uSpec,vec2(t,.5),0.).rgb;
  // 空気とガラスの揺らぎが作る、放射状の細い筋
  float st=textureLod(uTex,vec2(ang*2.3+B.w,uTime*.004+B.w),1.).b;
  float st2=textureLod(uTex,vec2(ang*9.1-B.w,.37-uTime*.003),0.).a;
  float streak=.84+.3*st+.2*(st2-.5);
  float fall=1./(1.+rr*.62);
  return c*win*rev*start*fall*streak*B.x;
}`;

// 部屋：壁、机、文字、虹、光の筋
const sceneFrag = (head) => `${head}
in vec2 vUv;
out vec4 O;
uniform sampler2D uTex,uSdf,uSpec;
uniform vec3 uCam,uBg,uSurf,uFg,uMuted,uBeamCol;
uniform vec4 uView,uAct,uHov;
uniform vec3 uLamp;
uniform float uPx,uPxW,uLod,uBgLum,uBeamEdge;
uniform vec4 uBeam[2];
uniform float uTip[2];
${FAN_GLSL}

uint hashU(ivec2 p){
  uint x=uint(p.x)*1597334677u^uint(p.y)*3812015801u;
  x^=x>>16;x*=2246822519u;x^=x>>13;x*=3266489917u;x^=x>>16;
  return x;
}
vec3 hash3(ivec2 p){
  uint x=hashU(p);
  return vec3(float(x&1023u),float((x>>10)&1023u),float((x>>20)&1023u))/1023.;
}

// 枠の縁で、必ず地の色に戻る
float vigAt(vec2 w){
  return 1.-smoothstep(.2,1.,length((w-uVig.xy)/uVig.zw));
}

// 文字の面からの距離（世界の単位。内側が負）
float glyphD(vec2 p,out float cell){
  float c=clamp(floor(p.x+2.),0.,3.);
  cell=c;
  vec2 q=(p-vec2(c-1.5,LABEL_Y))/GLYPH_S+.5;
  vec2 cq=clamp(q,.004,.996);
  float d=textureLod(uSdf,vec2((c+cq.x)/4.,cq.y),0.).r;
  return (d+length(q-cq))*GLYPH_S;
}

// 白い光の筋
vec3 beamField(vec2 p,vec4 B,float tip,float soft){
  if(B.z<=.0005) return vec3(0.);
  float side=B.y;
  float xs=-side*uBeamEdge;
  float u=(p.x-xs)*side;
  float uh=(B.x-xs)*side;
  if(u<0.) return vec3(0.);
  float end=1.-smoothstep(uh-.002-soft*9.-tip*.3,uh+.002,u);
  float endH=1.-smoothstep(uh-.03,uh+.2,u);
  if(endH<=0.) return vec3(0.);
  float dy=p.y-BEAM_Y;
  float w=max(B.w,uPxW*.7)+soft;
  float core=exp(-dy*dy/(w*w));
  float halo=exp(-abs(dy)/(w*4.))*.1+exp(-abs(dy)/(w*16.))*.012;
  float air=.88+.24*textureLod(uTex,vec2(p.x*.21+uTime*.009,.41),0.).b;
  return uBeamCol*B.z*(core*end*2.4*(1.+tip*1.6*exp(-max(uh-u,0.)/.16))+halo*endH*1.5)*air;
}

// 塵：虹の中でだけ光る
float motes(vec2 p){
  float acc=0.;
  float px=uPxW;
  for(int i=0;i<2;i++){
    float sc=i==0?7.:13.;
    vec2 q=p*sc+vec2(sin(uTime*.05+float(i)*2.1)*.7,-uTime*(.09+.05*float(i)));
    vec2 fl=floor(q);
    vec2 g=q-fl-.5;
    vec3 h=hash3(ivec2(fl)+ivec2(i*37,i*11));
    if(h.z<.5) continue;
    vec2 c=(h.xy-.5)*.72;
    float r=length(g-c)/sc;
    float sz=max(.0011+.0022*h.x*h.x,px*.7);
    float tw=.45+.55*sin(uTime*(.5+h.y*1.1)+h.x*6.283);
    acc+=exp(-r*r/(sz*sz))*max(tw,0.)*(.5+.5*h.y);
  }
  return acc;
}

vec3 wallShade(vec2 p,float soft){
  vec4 a=textureLod(uTex,p*.714,uLod);
  vec4 b=textureLod(uTex,vec2(p.y,-p.x)*.263+.37,uLod+.5);
  vec2 nr=(a.rg-.5)*2.;
  float pool=exp(-dot2((p-vec2(uPx*.35,.95))/vec2(2.4,1.5)));
  float vg=vigAt(p);
  float vs=sat(vg*2.2);
  vec3 base=mix(uBg,uSurf,vg*(.45+.55*pool));
  float quiet=1.-.72*uBgLum;
  base*=1.+(b.b-.5)*.34*vs*quiet;
  base*=1.+dot(nr,vec2(.14,.62))*.3*vs*quiet;
  base*=mix(1.,.7+.3*smoothstep(0.,.55,p.y),vs*(1.-.5*uBgLum));
  base*=1.-.34*vs*quiet*softBox(p-vec2(uPx,.2),vec2(.24,.2),.22);
  base+=uSurf*uLamp.z*.75*exp(-dot2(p-uLamp.xy)/.42);

  // 光の筋が壁をかすめる
  for(int i=0;i<2;i++){
    if(uBeam[i].z>.0005){
      float side=uBeam[i].y;
      float u=(p.x+side*uBeamEdge)*side;
      float uh=(uBeam[i].x+side*uBeamEdge)*side;
      float ax=1.-smoothstep(uh-.06,uh+.12,u);
      base+=uBeamCol*uBeam[i].z*ax*.0045*exp(-abs(p.y-BEAM_Y)/.16);
    }
  }

  float cell;
  float gd=glyphD(p,cell);
  float cellDummy;
  float gdS=glyphD(p+vec2(.0,.018),cellDummy);
  base*=1.-(.5-.3*uBgLum)*(1.-smoothstep(-.004,.05+soft,gdS));

  // 虹が壁をなめる。細かな凹凸が、斜めの光で浮かぶ
  vec3 E=vec3(0.);
  vec2 lightDir=vec2(0.,1.);
  float lw=0.;
  for(int i=0;i<2;i++){
    vec3 e=fanField(p,uFanA[i],uFanB[i],uFanC[i],soft);
    float l=lumOf(e);
    if(l>.00002){
      vec2 to=normalize(p-uFanA[i].xy);
      float rake=max(1.+dot(nr,-to)*.5,.4);
      float sh=1.;
      float s=.006;
      for(int k=0;k<7;k++){
        float cd;
        float dq=glyphD(p-to*s,cd);
        sh=min(sh,sat(.5+dq/(s*.16+.004)));
        s+=clamp(dq,.012,.12);
        if(s>.62||sh<.01) break;
      }
      e*=rake*(.3+.7*sh);
      E+=e;
      lightDir=mix(lightDir,to,l/(l+lw+1e-5));
      lw+=l;
    }
  }
  vec3 col=base*(1.-.82*uBgLum*sat(lumOf(E)*2.2))+E*.72;

  // 文字：壁から少し浮いた、薄い板
  float aa=uPxW*.75+soft;
  float cov=1.-smoothstep(-aa,aa,gd);
  if(cov>0.){
    int ci=int(cell);
    float act=max(uAct[ci],uHov[ci]*.42);
    vec3 face=mix(uMuted,uFg,act);
    vec3 lit=face*(.94+.06*a.a)+face*E*.5;
    if(gd>-.014&&soft<.006){
      vec2 e2=vec2(.0028,0.);
      float cd;
      vec2 g=vec2(glyphD(p+e2.xy,cd)-glyphD(p-e2.xy,cd),glyphD(p+e2.yx,cd)-glyphD(p-e2.yx,cd));
      g=g/max(length(g),1e-5);
      float rim=1.-smoothstep(0.,.011,abs(gd));
      lit+=face*rim*max(dot(g,vec2(-.28,.96)),0.)*.16;
      lit*=1.-rim*max(dot(g,vec2(.2,-.98)),0.)*.2;
      lit+=E*rim*max(dot(g,-lightDir),0.)*2.6;
    }
    col=mix(col,lit,cov);
  }
  return col;
}

// 手前の空間に見える虹と光の筋
vec3 airAt(vec3 ro,vec3 rd,float soft,float limit){
  vec3 c=vec3(0.);
  for(int l=0;l<3;l++){
    float z=ZM+(float(l)-1.)*.1;
    if(z<=limit) continue;
    float s=(z-ro.z)/rd.z;
    if(s<=0.) continue;
    vec3 q=ro+rd*s;
    if(q.y<=0.) continue;
    for(int i=0;i<2;i++){
      vec3 e=fanField(q.xy,uFanA[i],uFanB[i],uFanC[i],soft);
      if(lumOf(e)>.00002){
        float k=.2;
        if(l==1) k=.2+motes(q.xy)*3.;
        c+=e*k;
      }
    }
  }
  if(ZM>limit){
    float s=(ZM-ro.z)/rd.z;
    if(s>0.){
      vec3 q=ro+rd*s;
      if(q.y>0.){
        c+=beamField(q.xy,uBeam[0],uTip[0],soft)+beamField(q.xy,uBeam[1],uTip[1],soft);
      }
    }
  }
  return c;
}

vec3 tableShade(vec3 T,vec3 rd,float fx,float fz){
  float D0=uCam.z;
  vec4 a=textureLod(uTex,T.xz*.52,uLod+.7);
  vec4 b=textureLod(uTex,T.zx*vec2(.19,.23)+.11,uLod+.4);
  vec2 nr=(a.rg-.5)*2.;
  float pk=D0/(D0-T.z);
  float tv=vigAt(vec2(T.x*pk,uCam.y-uCam.y*pk));
  float pool=exp(-dot2((T.xz-vec2(uPx*.3,.7))/vec2(2.6,1.3)));
  vec3 alb=mix(uBg,uSurf,tv*(.3+.7*pool));
  float ts=sat(tv*2.2);
  float qt=1.-.72*uBgLum;
  alb*=mix(1.,.84+.32*b.b+.22*(a.a-.5),ts*qt);
  alb*=mix(1.,.6+.4*smoothstep(0.,.55,T.z),ts*(1.-.5*uBgLum));

  // ガラスの影と、ガラスが集めた光
  vec2 c=T.xz-vec2(uPx,(ZB+ZF)*.5+.04);
  alb*=1.-(.5-.32*uBgLum)*softBox(c,vec2(.22,.2),.2);
  alb*=1.-(.8-.4*uBgLum)*softBox(c,vec2(PF+.008,(ZF-ZB)*.5+.03),.018);
  alb+=uSurf*softBox(c-vec2(0.,.02),vec2(.1,.14),.09)*(.45+.55*a.b)*.3*qt;

  // 机の磨かれた面に、部屋が映る
  vec3 N=normalize(vec3(nr.x*.0055,1.,nr.y*.0055));
  vec3 r=reflect(rd,N);
  float ci=sat(-dot(rd,N));
  float F=.04+.96*pow(1.-ci,5.);
  F=min(F*1.75,.92);
  float s=-T.z/min(r.z,-1e-3);
  vec3 W=T+r*s;
  float soft=.003+s*.012;
  vec3 refl=wallShade(W.xy,soft);
  refl+=airAt(T,r,soft*.6,-1.)*smoothstep(ZM-.06,ZM+.14,T.z);
  vec3 col=alb*(1.-F)+mix(uBg,refl,sat(tv*1.6))*F;

  // 光の筋が机を照らす
  for(int i=0;i<2;i++){
    if(uBeam[i].z>.0005){
      float side=uBeam[i].y;
      float u=(T.x+side*uBeamEdge)*side;
      float uh=(uBeam[i].x+side*uBeamEdge)*side;
      float ax=1.-smoothstep(uh-.05,uh+.03,u);
      col+=uBeamCol*uBeam[i].z*ax*.007*exp(-dot2(vec2((T.z-ZM)/.2,0.)))*(.7+.6*a.b);
    }
  }

  // 目盛り：机に彫った細い線
  float zs=.74;
  float xw=T.x;
  float guideW=.0016;
  float guide=(1.-smoothstep(guideW,guideW+fz,abs(T.z-zs)))*(1.-smoothstep(2.04,2.08,abs(xw)));
  float minor=(1.-smoothstep(.0014,.0014+fx,abs(fract(xw*10.+.5)-.5)/10.))*(1.-smoothstep(.028,.028+fz,abs(T.z-zs-.03)))*(1.-smoothstep(2.0,2.02,abs(xw)));
  float major=(1.-smoothstep(.0026,.0026+fx,abs(fract(xw-.5+.5)-.5)))*(1.-smoothstep(.058,.058+fz,abs(T.z-zs-.06)))*(1.-smoothstep(2.0,2.02,abs(xw)));
  float ci2=clamp(floor(xw+2.),0.,3.);
  float act=uAct[int(ci2)];
  vec3 ink=mix(uMuted,uFg,act*.8)*(.26+.5*act);
  float mark=max(guide*.5,max(minor*.55,major));
  float mfade=smoothstep(2.3,1.6,abs(xw));
  col=mix(col,ink,mark*mfade*.75);
  return col;
}

void main(){
  vec2 wp=mix(uView.xy,uView.zw,vUv);
  vec3 ro=uCam;
  vec3 rd=normalize(vec3(wp,0.)-ro);
  vec3 col;
  float limit=-1.;
  float H=uCam.y,D=uCam.z;
  if(wp.y>=-uPxW){
    col=wallShade(wp,uPxW*.25);
    if(wp.y<uPxW){
      vec3 T0=ro+rd*(ro.y/max(-rd.y,1e-3));
      col=mix(tableShade(T0,rd,uPxW,uPxW),col,smoothstep(-uPxW,uPxW,wp.y));
    }
  }else{
    float tt=ro.y/max(-rd.y,1e-3);
    vec3 T=ro+rd*tt;
    float dd=H-wp.y;
    float fz=H*D/(dd*dd)*uPxW;
    float fx=uPxW*(D-T.z)/D;
    col=tableShade(T,rd,fx,fz);
    limit=T.z;
  }
  vec3 air=airAt(ro,rd,uPxW*.25,limit);
  col=col*(1.-.8*uBgLum*sat(lumOf(air)*4.))+air;
  O=vec4(enc(col),1.);
}`;

// ガラス：部屋を描いた面を環境にして、光線を追う
const glassFrag = (head) => {
  const len = Math.hypot(PH, PA - PF);
  const nx = PH / len;
  const ny = -(PA - PF) / len;
  const bellyD = nx * PF;
  const sT = Math.sin(TILT);
  const cT = Math.cos(TILT);
  const frontD = sT * PH + cT * ZF;
  return `${head}
in vec2 vUv;
out vec4 O;
uniform sampler2D uScene,uSpec,uTex;
uniform vec3 uCam,uBg,uSurf,uMuted,uWhite,uLamp;
uniform vec4 uView,uBox;
uniform float uPx,uPxW,uBev,uSide,uLit,uFlash,uFanI,uFanW,uAbsorb,uBeamW;
uniform float uIor[5];
uniform vec3 uKw[5];
uniform vec2 uPE,uPT[5],uPX[5],uPG[5];
const vec3 PN[6]=vec3[6](vec3(0.,1.,0.),vec3(0.,-1.,0.),vec3(0.,${f(sT)},${f(cT)}),vec3(0.,0.,-1.),vec3(${f(nx)},${f(ny)},0.),vec3(${f(-nx)},${f(ny)},0.));
const float PDIST[6]=float[6](PH,0.,${f(frontD)},-ZB,${f(bellyD)},${f(bellyD)});

${FAN_GLSL}

vec2 toUv(vec3 q){
  float k=uCam.z/(uCam.z-q.z);
  vec2 w=uCam.xy+(q.xy-uCam.xy)*k;
  return (w-uView.xy)/(uView.zw-uView.xy);
}
vec3 sceneAt(vec2 uv){return dec(textureLod(uScene,uv,0.).rgb);}
bool inFrame(vec2 uv){return uv.x>0.002&&uv.x<.998&&uv.y>0.002&&uv.y<.998;}

float gLamp=1.;

// ガラスの外に広がる世界。部屋の面、天井の灯り、手前の大きな窓
vec3 envAt(vec3 p,vec3 d){
  float sW=d.z<-1e-4?-p.z/d.z:1e9;
  float sT=d.y<-1e-4?-p.y/d.y:1e9;
  float sC=d.y>1e-4?(3.3-p.y)/d.y:1e9;
  float sF=d.z>1e-4?(3.6-p.z)/d.z:1e9;
  float m=min(sW,min(sT,min(sC,sF)));
  vec3 q=p+d*m;
  if(m==sW){
    vec2 uv=toUv(q);
    vec3 c=inFrame(uv)?sceneAt(uv):mix(uBg,uSurf,.5);
    c+=uWhite*uLamp.z*gLamp*4.5*exp(-dot2(q.xy-uLamp.xy)/.05);
    return c;
  }
  if(m==sT){
    vec2 uv=toUv(q);
    return inFrame(uv)?sceneAt(uv):uSurf*.5;
  }
  if(m==sC){
    // 天井の細い灯りが3本
    vec2 z=q.xz-vec2(uBox.x*.12,1.3);
    float bars=softBox(vec2(z.x,z.y),vec2(2.4,.05),.012)+softBox(vec2(z.x,z.y-.34),vec2(2.4,.05),.012)+softBox(vec2(z.x,z.y+.34),vec2(2.4,.05),.012);
    float wash=exp(-dot2(z/vec2(3.,1.6)));
    float panel=softBox(z-vec2(-.5,.1),vec2(1.15,.62),.035);
    return mix(uBg,uMuted,.06)+uWhite*(bars*9.+wash*.05+panel*.42);
  }
  // 手前：カーソルで動く窓と、両脇の細い灯り
  vec2 w=q.xy-uBox.xy;
  float pane=softBox(w,vec2(.2,.8),.1)*mix(.12,1.,smoothstep(-.8,.9,w.y))+softBox(w-vec2(-.14,0.),vec2(.014,.7),.008)*5.;
  float spot=exp(-dot2(w-vec2(0.,.08))/.009)*uBox.w*gLamp;
  float strips=softBox(vec2(abs(q.x)-3.1,q.y-1.6),vec2(.045,1.5),.012);
  float room=exp(-dot2((q.xy-vec2(0.,1.7))/vec2(4.5,2.6)));
  return mix(uBg,uSurf,room)*.7+uWhite*(pane*uBox.z*(.25+.75*gLamp)+spot*14.+strips*5.*step(.001,gLamp));
}

void prismT(vec3 ro,vec3 rd,out float t0,out float t1,out int idx){
  t0=-1e6;t1=1e6;idx=0;
  for(int i=0;i<6;i++){
    float dn=dot(rd,PN[i]);
    float dist=PDIST[i]-dot(ro,PN[i]);
    if(abs(dn)<1e-6){
      if(dist<0.) t1=-1e6;
      continue;
    }
    float t=dist/dn;
    if(dn<0.){
      if(t>t0){t0=t;idx=i;}
    }else{
      t1=min(t1,t);
    }
  }
}

// 角は少し丸い。髪の毛ほどの幅で、向きが隣の面へ移る
vec3 bevN(vec3 lp,int j){
  vec3 n=PN[j];
  for(int i=0;i<6;i++){
    if(i==j) continue;
    float d=PDIST[i]-dot(lp,PN[i]);
    float k=1.-sat(d/uBev);
    n+=PN[i]*k*k*.8;
  }
  return normalize(n);
}

float fres(float c,float eta){
  float s2=(1.-c*c)/(eta*eta);
  float ct=sqrt(max(1.-s2,0.));
  float rs=(c-eta*ct)/(c+eta*ct);
  float rp=(eta*c-ct)/(eta*c+ct);
  return .5*(rs*rs+rp*rp);
}

vec3 shade(vec3 ro,vec3 rd,int idx,float tn,int kStep,int bMax,float norm,float outerLamp){
  vec3 lp=ro+rd*tn;
  vec3 off=vec3(uPx,0.,0.);
  vec3 n=bevN(lp,idx);
  float c0=sat(-dot(rd,n));
  float F=fres(c0,1.61);
  gLamp=outerLamp;
  vec3 col=F*envAt(lp+off,reflect(rd,PN[idx]));
  // 磨いた角の細い光
  float rim=0.;
  for(int i=0;i<6;i++){
    if(i!=idx){
      float k=1.-sat((PDIST[i]-dot(lp,PN[i]))/uBev);
      rim=max(rim,k*k);
    }
  }
  col+=uWhite*rim*outerLamp*(.03+.2*sat(dot(n,vec3(-.28,.82,.5))));
  gLamp=outerLamp*.12;
  for(int k=0;k<5;k+=kStep){
    float eta=uIor[k];
    vec3 d=refract(rd,PN[idx],1./eta);
    vec3 q=lp-PN[idx]*3e-4;
    float w=1.-F;
    vec3 acc=vec3(0.);
    float path=0.;
    for(int b=0;b<bMax;b++){
      float s=1e6;
      int j=0;
      for(int i=0;i<6;i++){
        float dn=dot(d,PN[i]);
        if(dn>1e-5){
          float t=(PDIST[i]-dot(q,PN[i]))/dn;
          if(t<s){s=t;j=i;}
        }
      }
      s=max(s,0.);
      q+=d*s;
      path+=s;
      vec3 N=PN[j];
      float c=max(dot(d,N),.0005);
      float ee=1e6;
      for(int i=0;i<6;i++){
        if(i!=j) ee=min(ee,PDIST[i]-dot(q,PN[i]));
      }
      float edge=exp(-max(ee,0.)/(uBev*.8));
      acc+=uWhite*w*edge*.018;
      w*=1.-.55*edge;
      float s2=eta*eta*(1.-c*c);
      float Fi=1.;
      if(s2<1.){
        float ct=sqrt(1.-s2);
        float rs=(eta*c-ct)/(eta*c+ct);
        float rp=(c-eta*ct)/(c+eta*ct);
        Fi=.5*(rs*rs+rp*rp);
        vec3 Td=normalize(eta*d-(eta*c-ct)*N);
        acc+=w*(1.-Fi)*exp(-uAbsorb*path)*envAt(q+off,Td);
      }
      w*=Fi;
      if(w<.02) break;
      d=d-2.*dot(d,N)*N;
      q-=N*3e-4;
    }
    if(w>=.02) acc+=w*exp(-uAbsorb*path)*mix(uBg,uSurf,.55)*.8;
    col+=acc*uKw[k]*norm;
  }
  return col;
}

float segD(vec2 p,vec2 a,vec2 b){
  vec2 pa=p-a,ba=b-a;
  float h=sat(dot(pa,ba)/dot(ba,ba));
  return length(pa-ba*h);
}

// ガラスの中を通る光と、光に照らされた縁
vec3 innerLight(vec3 lp,vec3 rd,int idx){
  vec3 res=vec3(0.);
  vec3 d=rd;
  float glow=uLit+uFlash;
  if(glow>.001&&abs(d.z)>1e-4){
    float s=(ZM-lp.z)/d.z;
    if(s>0.){
      vec2 Q=(lp+d*s).xy;
      float wb=max(uBeamW,uPxW*.7);
      float dO=segD(Q,vec2(uPE.x-6.,uPE.y),uPE);
      res+=uWhite*uLit*(exp(-dO*dO/(wb*wb))*2.4+exp(-dO/(wb*4.))*.15);
      Q.x*=uSide;
      float wd=.0024+uPxW*.55;
      for(int k=0;k<5;k++){
        float d1=min(segD(Q,uPE,uPT[k]),segD(Q,uPT[k],uPX[k]));
        float g=exp(-d1*d1/(wd*wd));
        float h=exp(-d1/(wd*7.));
        res+=uKw[k]*(g*3.6+h*.08)*glow;
        float dg=segD(Q,uPX[k],uPG[k]);
        res+=uKw[k]*exp(-dg*dg/(wd*wd))*.34*glow;
      }
      float dE=length(Q-uPE);
      float dT=length(Q-uPT[2]);
      res+=uWhite*uFlash*(exp(-dE*dE/.0009)*5.+exp(-dT*dT/.0016)*2.5);
      res+=uWhite*uFlash*.1*exp(-dot2((Q-vec2(0.,PH*.45))/vec2(.3,.22)));
    }
  }
  // 縁が、中の光を拾って光る
  float e=1e6;
  for(int i=0;i<6;i++){
    if(i==idx) continue;
    e=min(e,PDIST[i]-dot(lp,PN[i]));
  }
  float ed=exp(-max(e,0.)/(.009+uPxW));
  float tint=fract(lp.x*.9+lp.y*1.3+lp.z*.8+.5);
  res+=textureLod(uSpec,vec2(tint,.5),0.).rgb*ed*(uLit*.7+uFlash*3.);
  // 上面から虹が出ていく場所
  if(idx==0){
    float x=lp.x*uSide;
    float xc=uPX[2].x;
    float t=sat((x-xc)/max(uFanW,.01)+.5);
    float bandX=exp(-dot2(vec2((x-xc)/max(uFanW*.62,.008),0.)));
    float bandZ=exp(-dot2(vec2((lp.z-ZM)/.05,0.)));
    res+=textureLod(uSpec,vec2(t,.5),0.).rgb*bandX*bandZ*uFanI*2.6;
  }
  return res;
}

void main(){
  vec2 wp=mix(uView.xy,uView.zw,vUv);
  vec3 ro=uCam-vec3(uPx,0.,0.);
  vec3 rd=normalize(vec3(wp.x-uPx,wp.y,0.)-ro);
  float t0,t1;
  int idx;
  prismT(ro,rd,t0,t1,idx);
  // 弦の長さは、輪郭で 0 を通る。1画素ぶんの変化で割れば、輪郭のなめらかな被覆になる
  float f0=t1-t0;
  float cov=sat(f0/clamp(fwidth(f0),1e-5,.25)+.5);

  float ty=-ro.y/min(rd.y,-1e-3);
  vec3 T=ro+rd*ty;
  vec3 r=vec3(rd.x,-rd.y,rd.z);
  float m0,m1;
  int midx;
  prismT(T,r,m0,m1,midx);
  float fm=m1-m0;
  float covM=sat(fm/clamp(fwidth(fm),1e-5,.25)+.5);

  vec3 col=sceneAt(vUv);
  if(covM>0.&&wp.y<0.&&cov<1.){
    float ci=sat(-rd.y);
    float F=min((.04+.96*pow(1.-ci,5.))*1.75,.92);
    vec3 g=shade(T,r,midx,m0,2,2,1.667,0.);
    col=mix(col,g,covM*F*(1.-sat(wp.y/-.9)));
  }
  if(cov>0.){
    vec3 lp=ro+rd*t0;
    vec3 g=shade(ro,rd,idx,t0,1,4,1.,1.);
    g+=innerLight(lp,rd,idx);
    // 虹がガラスより手前を通るところ
    for(int l=0;l<3;l++){
      float z=ZM+(float(l)-1.)*.1;
      if(z<=lp.z) continue;
      vec3 q=uCam+rd*((z-uCam.z)/rd.z);
      if(q.y<=0.) continue;
      g+=(fanField(q.xy,uFanA[0],uFanB[0],uFanC[0],uPxW*.25)+fanField(q.xy,uFanA[1],uFanB[1],uFanC[1],uPxW*.25))*.42;
    }
    col=mix(col,g,cov);
  }
  O=vec4(enc(col),1.);
}`;
};

// 光のにじみ：縮めては広げる
const downFrag = (head) => `${head}
in vec2 vUv;
out vec4 O;
uniform sampler2D uT;
uniform vec2 uHp;
uniform float uK;
vec3 t(vec2 uv){return dec(textureLod(uT,uv,0.).rgb);}
void main(){
  vec3 c=t(vUv)*4.+t(vUv-uHp)+t(vUv+uHp)+t(vUv+vec2(uHp.x,-uHp.y))+t(vUv-vec2(uHp.x,-uHp.y));
  c/=8.;
  if(uK>0.){
    float l=max(c.r,max(c.g,c.b));
    if(!(l>=0.)){c=vec3(0.);l=0.;}
    c=min(c,vec3(40.))*smoothstep(uK,uK*2.4,l);
  }
  O=vec4(enc(c),1.);
}`;
const upFrag = (head) => `${head}
in vec2 vUv;
out vec4 O;
uniform sampler2D uT;
uniform vec2 uHp;
vec3 t(vec2 uv){return dec(textureLod(uT,uv,0.).rgb);}
void main(){
  vec3 c=t(vUv+vec2(-2.*uHp.x,0.))+t(vUv+vec2(2.*uHp.x,0.))+t(vUv+vec2(0.,2.*uHp.y))+t(vUv+vec2(0.,-2.*uHp.y));
  c+=2.*(t(vUv+uHp)+t(vUv-uHp)+t(vUv+vec2(uHp.x,-uHp.y))+t(vUv+vec2(-uHp.x,uHp.y)));
  O=vec4(enc(c/12.),1.);
}`;
// 仕上げ：明るすぎる所を白へ寄せ、sRGB にして、揺らして階調の段を消す。縁は地へ溶かす
const compFrag = (head) => `${head}
in vec2 vUv;
out vec4 O;
uniform sampler2D uHdr,uBloom;
uniform float uBloomK,uFade,uS;
vec3 toneMap(vec3 c){
  float S=uS;
  float p=max(c.r,max(c.g,c.b));
  if(p<=S) return c;
  if(S>.995) return min(c,vec3(1.));
  float m=S+(1.-S)*(1.-exp(-(p-S)/(1.-S)));
  vec3 o=c*(m/p);
  float hot=1.-exp(-max(p-1.1,0.)*.42);
  return mix(o,vec3(m),hot);
}
vec3 toGamma(vec3 c){
  c=clamp(c,0.,1.);
  return mix(c*12.92,1.055*pow(c,vec3(1./2.4))-.055,step(.0031308,c));
}
float rnd(vec2 p){
  vec3 q=fract(vec3(p.xyx)*.1031);
  q+=dot(q,q.yzx+33.33);
  return fract((q.x+q.y)*q.z);
}
void main(){
  vec3 c=dec(textureLod(uHdr,vUv,0.).rgb)+dec(textureLod(uBloom,vUv,0.).rgb)*uBloomK;
  c=toGamma(toneMap(c));
  float n=rnd(gl_FragCoord.xy)+rnd(gl_FragCoord.xy+17.3)-1.;
  c+=n/255.;
  float a=smoothstep(0.,.05,vUv.x)*smoothstep(0.,.05,1.-vUv.x)*smoothstep(0.,.13,vUv.y)*smoothstep(0.,.07,1.-vUv.y)*uFade;
  O=vec4(c*a,a);
}`;

// ---- 文字の距離場（Felzenszwalb の距離変換）
const INF = 1e20;
function edt1d(grid, offset, stride, n, fv, v, z) {
  v[0] = 0;
  z[0] = -INF;
  z[1] = INF;
  fv[0] = grid[offset];
  for (let q = 1, k = 0, s = 0; q < n; q++) {
    fv[q] = grid[offset + q * stride];
    const q2 = q * q;
    do {
      const r = v[k];
      s = (fv[q] - fv[r] + q2 - r * r) / (q - r) * 0.5;
    } while (s <= z[k] && --k > -1);
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = INF;
  }
  for (let q = 0, k = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const r = v[k];
    const qr = q - r;
    grid[offset + q * stride] = fv[r] + qr * qr;
  }
}
function edt(grid, S, fv, v, z) {
  for (let x = 0; x < S; x++) edt1d(grid, x, S, S, fv, v, z);
  for (let y = 0; y < S; y++) edt1d(grid, y * S, 1, S, fv, v, z);
}
function buildGlyphAtlas(labels, family, S) {
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const atlas = new Float32Array(S * labels.length * S);
  const outer = new Float64Array(S * S);
  const inner = new Float64Array(S * S);
  const fv = new Float64Array(S);
  const v = new Uint16Array(S);
  const z = new Float64Array(S + 1);
  labels.forEach((label, c) => {
    ctx.clearRect(0, 0, S, S);
    ctx.font = `400 ${Math.round(S * 0.7)}px ${family}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, S / 2, S * 0.51);
    const d = ctx.getImageData(0, 0, S, S).data;
    for (let i = 0; i < S * S; i++) {
      const a = d[i * 4 + 3] / 255;
      outer[i] = a >= 1 ? 0 : a <= 0 ? INF : Math.pow(Math.max(0, 0.5 - a), 2);
      inner[i] = a >= 1 ? INF : a <= 0 ? 0 : Math.pow(Math.max(0, a - 0.5), 2);
    }
    edt(outer, S, fv, v, z);
    edt(inner, S, fv, v, z);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const i = y * S + x;
        const value = (Math.sqrt(outer[i]) - Math.sqrt(inner[i])) / S;
        // 下から上へ並べる（世界の y と同じ向き）
        atlas[(S - 1 - y) * S * labels.length + c * S + x] = value;
      }
    }
  });
  return atlas;
}

// なめらかな追従（臨界減衰）
function follow(state, goal, w, dt) {
  const e = Math.exp(-w * dt);
  const j = (state.v + w * (state.x - goal)) * dt;
  state.x = goal + (state.x - goal + j) * e;
  state.v = (state.v - w * j) * e;
}

export function mount(root) {
  const canvas = root.querySelector('.scene');
  const tablist = root.querySelector('[role="tablist"]');
  const tabs = [...root.querySelectorAll('[role="tab"]')];
  const panel = root.querySelector('[role="tabpanel"]');
  const probe = root.querySelector('.probe');
  const labels = tabs.map((tab) => tab.textContent.trim());
  const motionQuery = matchMedia('(prefers-reduced-motion: reduce)');
  const schemeQuery = matchMedia('(prefers-color-scheme: dark)');
  const automated = navigator.webdriver === true;
  let calm = motionQuery.matches;

  const cleanups = [];
  const on = (target, type, fn, options) => {
    target.addEventListener(type, fn, options);
    cleanups.push(() => target.removeEventListener(type, fn, options));
  };

  // ---- 選択：描けなくても、タブとして動く
  let current = Math.max(0, tabs.findIndex((tab) => tab.getAttribute('aria-selected') === 'true'));
  const cellX = (i) => i - (CELLS - 1) / 2;
  const slide = { x: cellX(current), v: 0 };
  const lead = { x: cellX(current), v: 0 };
  let goal = cellX(current);
  let travelSide = 1;
  let wake = () => {};
  let onSelect = () => {};
  let hoverTarget = -1;

  const applySelection = (i) => {
    tabs.forEach((tab, k) => {
      tab.setAttribute('aria-selected', k === i ? 'true' : 'false');
      if (k === i) tab.removeAttribute('tabindex');
      else tab.setAttribute('tabindex', '-1');
    });
    panel.setAttribute('aria-labelledby', tabs[i].id);
    panel.textContent = `${labels[i]}ごとの表示`;
  };
  const select = (i, pulse) => {
    if (i === current) {
      if (pulse) onSelect(i, true);
      return;
    }
    const before = current;
    current = i;
    applySelection(i);
    goal = cellX(i);
    travelSide = i > before ? 1 : -1;
    onSelect(i, false);
  };
  tabs.forEach((tab, i) => {
    on(tab, 'click', () => select(i, true));
    on(tab, 'pointerenter', () => {
      hoverTarget = i;
      wake();
    });
    on(tab, 'pointerleave', () => {
      if (hoverTarget === i) hoverTarget = -1;
      wake();
    });
  });
  on(tablist, 'keydown', (event) => {
    const last = tabs.length - 1;
    let next = -1;
    if (event.key === 'ArrowRight') next = current === last ? 0 : current + 1;
    else if (event.key === 'ArrowLeft') next = current === 0 ? last : current - 1;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = last;
    if (next < 0) return;
    event.preventDefault();
    tabs[next].focus();
    select(next, false);
  });

  // ---- WebGL
  let gl = null;
  try {
    gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, powerPreference: 'high-performance' });
  } catch {
    gl = null;
  }
  if (!gl) return () => cleanups.forEach((off) => off());

  const floatOK = !!(gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float'));
  const parallel = automated ? null : gl.getExtension('KHR_parallel_shader_compile');
  const head = headFor(floatOK);

  const makeProgram = (vs, fs) => {
    const p = gl.createProgram();
    for (const [type, source] of [
      [gl.VERTEX_SHADER, vs],
      [gl.FRAGMENT_SHADER, fs],
    ]) {
      const s = gl.createShader(type);
      gl.shaderSource(s, source);
      gl.compileShader(s);
      gl.attachShader(p, s);
      gl.deleteShader(s);
    }
    gl.bindAttribLocation(p, 0, 'aPos');
    gl.linkProgram(p);
    return { p, u: {}, ready: false };
  };
  const finishProgram = (prog) => {
    if (!gl.getProgramParameter(prog.p, gl.LINK_STATUS)) {
      const logs = gl.getAttachedShaders(prog.p).map((s) => gl.getShaderInfoLog(s)).join(' ');
      throw new Error(logs.trim() || gl.getProgramInfoLog(prog.p) || 'link');
    }
    const count = gl.getProgramParameter(prog.p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < count; i++) {
      const info = gl.getActiveUniform(prog.p, i);
      prog.u[info.name.replace(/\[0\]$/, '')] = gl.getUniformLocation(prog.p, info.name);
    }
    prog.ready = true;
  };

  const programs = {
    bake: makeProgram(VERT, BAKE),
    scene: makeProgram(VERT, sceneFrag(head)),
    glass: makeProgram(VERT, glassFrag(head)),
    down: makeProgram(VERT, downFrag(head)),
    up: makeProgram(VERT, upFrag(head)),
    comp: makeProgram(VERT, compFrag(head)),
  };
  const programList = Object.values(programs);

  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.BLEND);

  const makeTexture = (wrap, minFilter) => {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, minFilter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
    return t;
  };
  const texRelief = makeTexture(gl.REPEAT, gl.LINEAR_MIPMAP_LINEAR);
  const texSdf = makeTexture(gl.CLAMP_TO_EDGE, gl.LINEAR);
  const texSpec = makeTexture(gl.CLAMP_TO_EDGE, gl.LINEAR);
  let glyphSize = 0;

  const makeTarget = (w, h) => {
    const tex = makeTexture(gl.CLAMP_TO_EDGE, gl.LINEAR);
    if (floatOK) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return { tex, fb, w, h };
  };
  const freeTarget = (t) => {
    gl.deleteTexture(t.tex);
    gl.deleteFramebuffer(t.fb);
  };

  const bakeRelief = () => {
    const size = 1024;
    gl.bindTexture(gl.TEXTURE_2D, texRelief);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texRelief, 0);
    gl.viewport(0, 0, size, size);
    gl.useProgram(programs.bake.p);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fb);
    gl.bindTexture(gl.TEXTURE_2D, texRelief);
    gl.generateMipmap(gl.TEXTURE_2D);
  };

  // ---- トークンを読む
  const paint = new OffscreenCanvas(1, 1).getContext('2d', { willReadFrequently: true });
  const colors = { bg: [0, 0, 0], surface: [0, 0, 0], fg: [0, 0, 0], muted: [0, 0, 0], accent: [0, 0, 0], white: [1, 1, 1], beam: [1, 1, 1] };
  const weights = new Float32Array(15);
  let timeScale = 1;
  let bevel = 0.006;
  let bevelToken = 1;
  const readColor = (style, name) => {
    probe.style.color = style.getPropertyValue(`--_${name}`).trim();
    paint.clearRect(0, 0, 1, 1);
    paint.fillStyle = getComputedStyle(probe).color;
    paint.fillRect(0, 0, 1, 1);
    const d = paint.getImageData(0, 0, 1, 1).data;
    return [toLinear(d[0] / 255), toLinear(d[1] / 255), toLinear(d[2] / 255)];
  };
  const readTokens = () => {
    const style = getComputedStyle(root);
    for (const name of ['bg', 'surface', 'fg', 'muted', 'accent']) colors[name] = readColor(style, name);
    const motion = style.getPropertyValue('--_motion').trim();
    const ms = motion.endsWith('ms') ? parseFloat(motion) : parseFloat(motion) * 1000;
    timeScale = clamp((Number.isFinite(ms) ? ms : 240) / 240, 0.4, 2.5);
    const radius = parseFloat(style.getPropertyValue('--_radius'));
    bevelToken = clamp((Number.isFinite(radius) ? radius : 14) / 14, 0.6, 2);

    // 虹：accent の色相を回す
    const lab = linearToOklab(colors.accent);
    const h0 = Math.atan2(lab[2], lab[1]);
    const C = Math.max(Math.hypot(lab[1], lab[2]), 0.19);
    const toneAt = (h) => hueTone(h, C, 0.67 + 0.1 * Math.cos(h - 1.92));
    const spec = new Float32Array(256 * 4);
    for (let i = 0; i < 256; i++) {
      const rgb = toneAt(h0 + (i / 255) * TURN);
      spec.set([rgb[0], rgb[1], rgb[2], 1], i * 4);
    }
    gl.bindTexture(gl.TEXTURE_2D, texSpec);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, 256, 1, 0, gl.RGBA, gl.FLOAT, spec);

    // 白：色相を一周ぶん足す
    const sum = [0, 0, 0];
    for (let i = 0; i < 72; i++) {
      const rgb = toneAt((i / 72) * Math.PI * 2);
      sum[0] += rgb[0];
      sum[1] += rgb[1];
      sum[2] += rgb[2];
    }
    const peak = Math.max(...sum);
    colors.white = sum.map((v) => mix(v / peak, 1, 0.8));
    // 明るい部屋では白が見えないので、光の筋を少し沈める
    const bgLum = luminance(colors.bg);
    colors.beam = colors.white.map((v, i) => mix(v, colors.muted[i] * 0.55, smooth(0.2, 0.75, bgLum)));

    // 波長ごとの重み。全部足すと、ちょうど透明になる
    const total = [0, 0, 0];
    const rows = [0, 1, 2, 3, 4].map((k) => toneAt(h0 + ((k + 0.5) / 5) * TURN));
    for (const row of rows) row.forEach((v, c) => (total[c] += v));
    rows.forEach((row, k) => row.forEach((v, c) => (weights[k * 3 + c] = v / total[c])));
  };

  // ---- 大きさ
  const view = { x0: -2.42, y0: -0.78, x1: 2.42, y1: 1.94, pxW: 0.004 };
  let W = 2;
  let H = 2;
  let scale = 1;
  let rt0 = null;
  let rt1 = null;
  let chain = [];
  const freeTargets = () => {
    if (rt0) freeTarget(rt0);
    if (rt1) freeTarget(rt1);
    chain.forEach(freeTarget);
    rt0 = rt1 = null;
    chain = [];
  };
  const measure = () => {
    const box = root.getBoundingClientRect();
    const cssW = Math.max(1, box.width);
    const cssH = Math.max(1, box.height);
    const dpr = Math.min(2, devicePixelRatio || 1) * scale;
    const nextW = Math.max(2, Math.round(cssW * dpr));
    const nextH = Math.max(2, Math.round(cssH * dpr));

    // 窓の中で、壁のどこが見えるか。4項目が横に収まるように決める
    const aspect = cssW / cssH;
    const halfW = aspect >= 1.6 ? 2.42 : 2.3;
    const height = (halfW * 2) / aspect;
    const y0 = -(0.78 + Math.max(0, height - 2.72) * 0.17);
    view.x0 = -halfW;
    view.x1 = halfW;
    view.y0 = y0;
    view.y1 = y0 + height;
    view.pxW = (halfW * 2) / nextW;

    // 押す場所を、絵の項目に合わせる
    const gutter = ((halfW - CELLS / 2) / (halfW * 2)) * 100;
    tablist.style.setProperty('--gutter', `${gutter.toFixed(3)}%`);
    tablist.style.setProperty('--label-y', `${(((view.y1 - LABEL_Y) / height) * 100).toFixed(3)}%`);
    tablist.style.setProperty('--label-size', `${(GLYPH_S * 92).toFixed(2)}%`);

    if (nextW === W && nextH === H && rt0) return;
    W = nextW;
    H = nextH;
    canvas.width = W;
    canvas.height = H;
    freeTargets();
    rt0 = makeTarget(W, H);
    rt1 = makeTarget(W, H);
    let w = W;
    let h = H;
    for (let i = 0; i < 5; i++) {
      w = Math.max(2, w >> 1);
      h = Math.max(2, h >> 1);
      chain.push(makeTarget(w, h));
    }
    // 文字の距離場は、見える大きさに足りるだけ作る
    ensureGlyphs(false);
  };
  const ensureGlyphs = (force) => {
    const needed = view.pxW > 0 ? GLYPH_S / view.pxW : 256;
    const size = needed > 400 ? 512 : needed > 200 ? 384 : 256;
    if (size <= glyphSize && !force) return;
    glyphSize = Math.max(size, glyphSize);
    const atlas = buildGlyphAtlas(labels, getComputedStyle(root).fontFamily, glyphSize);
    gl.bindTexture(gl.TEXTURE_2D, texSdf);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, glyphSize * labels.length, glyphSize, 0, gl.RED, gl.FLOAT, atlas);
  };

  // ---- 光の時間
  // lights[0]：いま当たっている光、lights[1]：去った場所に残る光
  const staticLight = (x, side) => ({ x, side, born: 0, dying: null, still: true });
  let lightNow = null;
  let lightOld = null;
  let awaitingArrival = false;
  let lastSide = 1;
  const evalLight = (light, now) => {
    const out = { I: 0, head: 0, spread: 0.02, w0: 0.02, beam: 0, bw: 0.003, flash: 0, travel: 1 };
    if (light.still) {
      // 動きを止めたとき：虹は細く開いたまま、静かに置く
      out.I = 0.62;
      out.head = 9;
      out.spread = (9 * Math.PI) / 180;
      out.w0 = 0.05;
      out.beam = 0.42;
      out.bw = 0.0034;
      return out;
    }
    const T = light.hold ? 1.35 : now - light.born;
    const reach = 0.17 * timeScale;
    const hit = T - reach;
    const h = clamp(T / reach);
    out.travel = 1 - (1 - h) * (1 - h);
    out.beam = hit < 0 ? 1 : REST_BEAM + (1 - REST_BEAM) * Math.exp(-hit / 1.7);
    out.bw = mix(0.0022, 0.0036, hit < 0 ? 1 : Math.exp(-hit / 1.3));
    out.flash = hit > 0 ? Math.exp(-hit / 0.24) : 0;
    if (hit > 0) {
      const open = smooth(0, 0.42, hit) * Math.exp(-Math.max(hit - 0.95, 0) / 2.3);
      out.I = smooth(0, 0.18, hit) * (REST_FAN + (1 - REST_FAN) * Math.exp(-hit / 2.5));
      out.head = (1 - Math.pow(1 - clamp(hit / 0.9), 3)) * 4.2;
      out.spread = (mix(1.0, 21, open) * Math.PI) / 180;
      out.w0 = mix(0.014, 0.12, open);
    }
    if (light.dying !== null) {
      const k = Math.exp(-(now - light.dying) / 0.42);
      out.I *= k;
      out.beam *= k * k;
      out.flash *= k;
    }
    return out;
  };
  const strike = (side, now, age = 0) => {
    if (lightNow) {
      lightNow.dying = now;
      lightOld = lightNow;
    }
    lastSide = side;
    lightNow = calm ? staticLight(slide.x, side) : { x: slide.x, side, born: now - age, dying: null, still: false };
  };
  onSelect = (i, pulse) => {
    const now = performance.now() * 0.001;
    if (calm) {
      slide.x = lead.x = goal;
      slide.v = lead.v = 0;
      strike(travelSide, now);
      lightOld = null;
      draw(now, 0);
      return;
    }
    if (pulse) {
      strike(lastSide, now);
    } else {
      if (lightNow) {
        lightNow.dying = now;
        lightOld = lightNow;
        lightNow = null;
      }
      awaitingArrival = true;
    }
    wake();
  };

  // ---- カーソル
  const cursor = { x: 0, y: 1, on: false };
  const lamp = { x: { x: 0, v: 0 }, y: { x: 1, v: 0 }, near: { x: 0, v: 0 } };
  on(root, 'pointermove', (event) => {
    const box = root.getBoundingClientRect();
    cursor.x = mix(view.x0, view.x1, (event.clientX - box.left) / Math.max(box.width, 1));
    cursor.y = mix(view.y1, view.y0, (event.clientY - box.top) / Math.max(box.height, 1));
    if (!cursor.on) {
      lamp.x.x = cursor.x;
      lamp.y.x = cursor.y;
    }
    cursor.on = true;
    if (calm) draw(performance.now() * 0.001, 0);
    else wake();
  });
  on(root, 'pointerleave', () => {
    cursor.on = false;
    wake();
  });

  // ---- 描く
  const act = [0, 0, 0, 0];
  const hov = [0, 0, 0, 0];
  act[current] = 1;
  const pathE = new Float32Array(PATHS[0].E);
  const pathT = new Float32Array(10);
  const pathX = new Float32Array(10);
  const pathG = new Float32Array(10);
  PATHS.forEach((path, k) => {
    pathT.set(path.T, k * 2);
    pathX.set(path.X, k * 2);
    pathG.set(path.G, k * 2);
  });
  const fanA = new Float32Array(8);
  const fanB = new Float32Array(8);
  const fanC = new Float32Array(6);
  const beamU = new Float32Array(8);
  const tipU = new Float32Array(2);
  let glassLit = 0;
  let glassFlash = 0;
  let glassFanI = 0;
  let glassFanW = 0.05;
  let ready = false;
  let dead = false;
  let raf = 0;
  let last = 0;
  let visible = true;

  const writeLight = (slot, light, now) => {
    const a = slot * 4;
    if (!light) {
      fanB[a] = 0;
      beamU[a + 2] = 0;
      return null;
    }
    const v = evalLight(light, now);
    const side = light.side;
    const phi = side * LEAN;
    const r0 = v.w0 / 2 / Math.tan(v.spread);
    const xc = light.x + side * XOUT;
    fanA[a] = xc - Math.sin(phi) * r0;
    fanA[a + 1] = PH - Math.cos(phi) * r0;
    fanA[a + 2] = phi;
    fanA[a + 3] = v.spread;
    fanB[a] = v.I;
    fanB[a + 1] = v.head;
    fanB[a + 2] = side;
    fanB[a + 3] = light.x * 0.37 + 0.13;
    fanC[slot * 3] = r0;
    fanC[slot * 3 + 1] = v.w0;
    const xs = -side * beamEdge();
    const end = (slot === 0 ? slide.x : light.x) + side * BEAM_ENTRY;
    beamU[a] = mix(xs, end, v.travel);
    beamU[a + 1] = side;
    beamU[a + 2] = v.beam;
    beamU[a + 3] = v.bw;
    tipU[slot] = v.travel < 1 ? 1 : 0;
    return v;
  };
  const beamEdge = () => view.x1 + 0.1;

  const pass = (target, prog) => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fb : null);
    gl.viewport(0, 0, target ? target.w : W, target ? target.h : H);
    gl.useProgram(prog.p);
  };
  const bindTex = (unit, tex, location) => {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(location, unit);
  };
  const glassRect = (px) => {
    // 手前の面は、下へ行くほど手前へ出る
    const zFoot = ZF + PH * Math.tan(TILT);
    const corners = [
      [px - PA, PH, ZB],
      [px + PA, PH, ZB],
      [px - PA, PH, ZF],
      [px + PA, PH, ZF],
      [px - PF, 0, ZB],
      [px + PF, 0, ZB],
      [px - PF, 0, zFoot],
      [px + PF, 0, zFoot],
    ];
    let minX = 1e9;
    let maxX = -1e9;
    let minY = 1e9;
    let maxY = -1e9;
    for (const [x, y, z] of corners) {
      for (const sign of [1, -1]) {
        const k = CAM[2] / (CAM[2] - z);
        const wx = CAM[0] + (x - CAM[0]) * k;
        const wy = CAM[1] + (sign * y - CAM[1]) * k;
        minX = Math.min(minX, wx);
        maxX = Math.max(maxX, wx);
        minY = Math.min(minY, wy);
        maxY = Math.max(maxY, wy);
      }
    }
    const px0 = Math.floor(((minX - view.x0) / (view.x1 - view.x0)) * W) - 3;
    const px1 = Math.ceil(((maxX - view.x0) / (view.x1 - view.x0)) * W) + 3;
    const py0 = Math.floor(((minY - view.y0) / (view.y1 - view.y0)) * H) - 3;
    const py1 = Math.ceil(((maxY - view.y0) / (view.y1 - view.y0)) * H) + 3;
    const x = clamp(px0, 0, W);
    const y = clamp(py0, 0, H);
    return [x, y, clamp(px1, 0, W) - x, clamp(py1, 0, H) - y];
  };

  let fade = automated || calm ? 1 : 0;
  function draw(now, dt) {
    if (!ready || dead || !rt0) return;

    // 滑る。動き出しも止まりぎわも、やわらかく
    if (!calm) {
      follow(lead, goal, 10.5 / timeScale, dt);
      follow(slide, lead.x, 14 / timeScale, dt);
      if (awaitingArrival && Math.abs(slide.x - goal) < 0.008 && Math.abs(slide.v) < 0.4) {
        awaitingArrival = false;
        strike(travelSide, now);
      }
      fade = Math.min(1, fade + dt * 2.4);
    }
    if (lightOld && lightOld.dying !== null && now - lightOld.dying > 2.4) lightOld = null;

    // 文字の明るさ
    for (let i = 0; i < CELLS; i++) {
      const want = i === current && (!awaitingArrival || Math.abs(slide.x - goal) < 0.4) ? 1 : 0;
      act[i] = calm ? (i === current ? 1 : 0) : mix(act[i], want, 1 - Math.exp(-dt * 9));
      const hw = i === hoverTarget ? 1 : 0;
      hov[i] = calm ? hw : mix(hov[i], hw, 1 - Math.exp(-dt * 12));
    }

    // カーソルの光
    const dx = cursor.x - slide.x;
    const dy = cursor.y - 0.3;
    const near = cursor.on ? 1 - smooth(0.55, 2.1, Math.hypot(dx, dy)) : 0;
    if (calm) {
      lamp.x.x = cursor.on ? cursor.x : slide.x;
      lamp.y.x = cursor.on ? cursor.y : 1;
      lamp.near.x = near;
    } else {
      if (cursor.on) {
        follow(lamp.x, cursor.x, 15, dt);
        follow(lamp.y, cursor.y, 15, dt);
      }
      follow(lamp.near, near, 7, dt);
    }

    const v0 = writeLight(0, lightNow, now);
    writeLight(1, lightOld, now);
    const litAim = v0 && v0.travel >= 1 ? v0.beam : 0;
    if (calm) glassLit = litAim;
    else glassLit = litAim > glassLit ? litAim : mix(glassLit, litAim, 1 - Math.exp(-dt * 9));
    glassFlash = v0 ? v0.flash : 0;
    glassFanI = v0 ? v0.I : calm ? glassFanI : mix(glassFanI, 0, 1 - Math.exp(-dt * 10));
    if (v0) glassFanW = v0.w0;

    const time = calm ? 12 : now % 3600;
    const lod = Math.max(0, Math.log2(731 * view.pxW));
    const bgLum = luminance(colors.bg);

    // ---- 部屋
    const sc = programs.scene;
    pass(rt0, sc);
    gl.uniform3fv(sc.u.uCam, CAM);
    gl.uniform4f(sc.u.uView, view.x0, view.y0, view.x1, view.y1);
    gl.uniform1f(sc.u.uTime, time);
    gl.uniform1f(sc.u.uPx, slide.x);
    gl.uniform1f(sc.u.uPxW, view.pxW);
    gl.uniform1f(sc.u.uLod, lod);
    gl.uniform1f(sc.u.uBgLum, bgLum);
    gl.uniform1f(sc.u.uBeamEdge, beamEdge());
    gl.uniform4f(sc.u.uVig, 0, (view.y0 + view.y1) / 2, view.x1, (view.y1 - view.y0) / 2);
    gl.uniform3fv(sc.u.uBg, colors.bg);
    gl.uniform3fv(sc.u.uSurf, colors.surface);
    gl.uniform3fv(sc.u.uFg, colors.fg);
    gl.uniform3fv(sc.u.uMuted, colors.muted);
    gl.uniform3fv(sc.u.uBeamCol, colors.beam);
    gl.uniform4fv(sc.u.uAct, act);
    gl.uniform4fv(sc.u.uHov, hov);
    gl.uniform3f(sc.u.uLamp, lamp.x.x, lamp.y.x, lamp.near.x);
    gl.uniform4fv(sc.u.uFanA, fanA);
    gl.uniform4fv(sc.u.uFanB, fanB);
    gl.uniform3fv(sc.u.uFanC, fanC);
    gl.uniform4fv(sc.u.uBeam, beamU);
    gl.uniform1fv(sc.u.uTip, tipU);
    bindTex(0, texRelief, sc.u.uTex);
    bindTex(1, texSdf, sc.u.uSdf);
    bindTex(2, texSpec, sc.u.uSpec);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // ---- ガラス
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, rt0.fb);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, rt1.fb);
    gl.blitFramebuffer(0, 0, W, H, 0, 0, W, H, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    const gs = programs.glass;
    pass(rt1, gs);
    const rect = glassRect(slide.x);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(rect[0], rect[1], rect[2], rect[3]);
    gl.uniform3fv(gs.u.uCam, CAM);
    gl.uniform4f(gs.u.uView, view.x0, view.y0, view.x1, view.y1);
    gl.uniform1f(gs.u.uPx, slide.x);
    gl.uniform1f(gs.u.uPxW, view.pxW);
    bevel = Math.max(0.0055 * bevelToken, view.pxW * 1.4);
    gl.uniform1f(gs.u.uBev, bevel);
    gl.uniform1f(gs.u.uSide, lastSide);
    gl.uniform1f(gs.u.uLit, glassLit);
    gl.uniform1f(gs.u.uFlash, glassFlash);
    gl.uniform1f(gs.u.uFanI, glassFanI);
    gl.uniform1f(gs.u.uFanW, glassFanW);
    gl.uniform1f(gs.u.uBeamW, v0 ? v0.bw : 0.003);
    gl.uniform1f(gs.u.uTime, time);
    gl.uniform4f(gs.u.uVig, 0, (view.y0 + view.y1) / 2, view.x1, (view.y1 - view.y0) / 2);
    gl.uniform4fv(gs.u.uFanA, fanA);
    gl.uniform4fv(gs.u.uFanB, fanB);
    gl.uniform3fv(gs.u.uFanC, fanC);
    gl.uniform1f(gs.u.uAbsorb, 0.1);
    gl.uniform3fv(gs.u.uBg, colors.bg);
    gl.uniform3fv(gs.u.uSurf, colors.surface);
    gl.uniform3fv(gs.u.uMuted, colors.muted);
    gl.uniform3fv(gs.u.uWhite, colors.white);
    gl.uniform3f(gs.u.uLamp, lamp.x.x, lamp.y.x, lamp.near.x);
    gl.uniform1fv(gs.u.uIor, ENV_IOR);
    gl.uniform3fv(gs.u.uKw, weights);
    gl.uniform2fv(gs.u.uPE, pathE);
    gl.uniform2fv(gs.u.uPT, pathT);
    gl.uniform2fv(gs.u.uPX, pathX);
    gl.uniform2fv(gs.u.uPG, pathG);
    // 手前の窓の映り。カーソルが近いほど、カーソルについて動く
    const boxX = slide.x * 1.57 - 0.32 + (lamp.x.x - slide.x) * 0.95 * lamp.near.x;
    const boxY = 1.42 + (lamp.y.x - 0.5) * 0.8 * lamp.near.x;
    gl.uniform4f(gs.u.uBox, boxX, boxY, 1.1 + 1.1 * lamp.near.x, lamp.near.x);
    bindTex(0, rt0.tex, gs.u.uScene);
    bindTex(1, texSpec, gs.u.uSpec);
    bindTex(2, texRelief, gs.u.uTex);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.disable(gl.SCISSOR_TEST);

    // ---- にじみ
    const dn = programs.down;
    let source = rt1;
    chain.forEach((target, i) => {
      pass(target, dn);
      gl.uniform2f(dn.u.uHp, 0.5 / target.w, 0.5 / target.h);
      gl.uniform1f(dn.u.uK, i === 0 ? 0.85 : 0);
      bindTex(0, source.tex, dn.u.uT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      source = target;
    });
    const upP = programs.up;
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    for (let i = chain.length - 1; i > 0; i--) {
      const target = chain[i - 1];
      pass(target, upP);
      gl.uniform2f(upP.u.uHp, 0.5 / target.w, 0.5 / target.h);
      bindTex(0, chain[i].tex, upP.u.uT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    gl.disable(gl.BLEND);

    // ---- 仕上げ
    const cp = programs.comp;
    pass(null, cp);
    gl.uniform1f(cp.u.uBloomK, 0.16);
    gl.uniform1f(cp.u.uFade, fade);
    gl.uniform1f(cp.u.uS, mix(0.82, 1, smooth(0.3, 0.85, bgLum)));
    bindTex(0, rt1.tex, cp.u.uHdr);
    bindTex(1, chain[0].tex, cp.u.uBloom);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  // ---- 速さが足りないときは、解像度を下げて 60fps を守る
  let sumDt = 0;
  let countDt = 0;
  let goodRuns = 0;
  let ceiling = 1;
  const watchSpeed = (dt) => {
    if (automated || dt > 0.1) return;
    sumDt += dt;
    countDt += 1;
    if (countDt < 45) return;
    const avg = sumDt / countDt;
    sumDt = 0;
    countDt = 0;
    if (avg > 0.0205 && scale > 0.5) {
      ceiling = Math.max(0.5, scale - 0.05);
      scale = Math.max(0.5, scale - 0.15);
      goodRuns = 0;
      measure();
    } else if (avg < 0.0172 && scale < ceiling) {
      goodRuns += 1;
      if (goodRuns > 5) {
        scale = Math.min(ceiling, scale + 0.05);
        goodRuns = 0;
        measure();
      }
    }
  };

  const frame = (ms) => {
    raf = 0;
    if (dead || !visible) return;
    const now = ms * 0.001;
    const dt = last ? Math.min(now - last, 0.05) : 0.016;
    const raw = last ? now - last : 0.016;
    last = now;
    if (!ready) {
      if (programList.every((p) => gl.getProgramParameter(p.p, parallel.COMPLETION_STATUS_KHR))) start();
      raf = requestAnimationFrame(frame);
      return;
    }
    watchSpeed(raw);
    draw(now, dt);
    if (!calm) raf = requestAnimationFrame(frame);
  };
  wake = () => {
    if (!raf && visible && !dead && (!ready || !calm)) raf = requestAnimationFrame(frame);
    else if (ready && calm && !dead) draw(performance.now() * 0.001, 0);
  };

  const start = () => {
    try {
      programList.forEach(finishProgram);
    } catch (error) {
      console.warn('tabs-prism: シェーダーを作れないので、WebGL を使わずに見せる', error);
      root.removeAttribute('data-gl');
      dead = true;
      return;
    }
    bakeRelief();
    readTokens();
    measure();
    root.setAttribute('data-gl', '');
    ready = true;
    // 開いたときは、光が当たった直後の姿から始める
    const now = performance.now() * 0.001;
    strike(1, now, 1.05);
    if (automated && lightNow) lightNow.hold = true;
    draw(now, 0);
  };

  // ---- 見えていないときは止める
  let onScreen = true;
  const updateVisible = () => {
    visible = onScreen && document.visibilityState !== 'hidden';
    if (visible) {
      last = 0;
      wake();
    } else if (raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  };
  const io = new IntersectionObserver((entries) => {
    onScreen = entries.some((e) => e.isIntersecting);
    updateVisible();
  });
  io.observe(root);
  on(document, 'visibilitychange', updateVisible);
  const ro = new ResizeObserver(() => {
    if (!ready) return;
    measure();
    if (calm) draw(performance.now() * 0.001, 0);
    else wake();
  });
  ro.observe(root);

  on(motionQuery, 'change', () => {
    calm = motionQuery.matches;
    if (!ready) return;
    const now = performance.now() * 0.001;
    if (calm) {
      slide.x = lead.x = goal;
      slide.v = lead.v = 0;
      awaitingArrival = false;
      lightOld = null;
      lightNow = staticLight(slide.x, lastSide);
      fade = 1;
      draw(now, 0);
    } else {
      lightNow = { x: slide.x, side: lastSide, born: now - 9, dying: null, still: false };
      wake();
    }
  });
  on(schemeQuery, 'change', () => {
    if (!ready) return;
    readTokens();
    wake();
  });
  on(canvas, 'webglcontextlost', (event) => {
    event.preventDefault();
    root.removeAttribute('data-gl');
    dead = true;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  });

  if (document.fonts && document.fonts.size > 0) {
    document.fonts.ready.then(() => {
      if (dead || !ready) return;
      ensureGlyphs(true);
      wake();
    });
  }

  // ---- 組み立て
  if (parallel) {
    raf = requestAnimationFrame(frame);
  } else {
    start();
    if (!dead && !calm) raf = requestAnimationFrame(frame);
  }

  return () => {
    dead = true;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    io.disconnect();
    ro.disconnect();
    for (const off of cleanups) off();
    root.removeAttribute('data-gl');
    freeTargets();
    for (const p of programList) gl.deleteProgram(p.p);
    gl.deleteBuffer(quad);
    gl.deleteVertexArray(vao);
    gl.deleteTexture(texRelief);
    gl.deleteTexture(texSdf);
    gl.deleteTexture(texSpec);
    const lose = gl.getExtension('WEBGL_lose_context');
    if (lose) lose.loseContext();
  };
}
