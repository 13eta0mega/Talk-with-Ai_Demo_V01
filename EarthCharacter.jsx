"use client";
import React from 'react';
/* Earth character: React render-once shell, exact geometry + nested transform rig.
 * Inspired by svg-character-animator's MorphAnimator architecture.
 * No sampled morph fallback: authored facial states share cubic topology.
 * React 18 is the only dependency. The source artwork is passed as svgSource.
 */
const {useRef,useState,useEffect,useImperativeHandle,forwardRef,memo}=React;
const h=React.createElement;
const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
const mix=(a,b,t)=>a+(b-a)*t;
const NS='http://www.w3.org/2000/svg';
const BASE={closeL:0,closeR:0,smile:-.22,mouth:0,wide:0,tilt:0,y:0,lean:0,brow:0,arch:0,blush:0};
const EMOTIONS={
 neutral:{label:'기본',hint:'차분한 정면',pose:{}},
 happy:{label:'기쁨',hint:'부드러운 미소',pose:{smile:1,mouth:.15,closeL:.22,closeR:.22,tilt:2,y:-2,blush:.4}},
 excited:{label:'신남',hint:'눈웃음과 활짝',pose:{smile:1,mouth:.8,closeL:1,closeR:1,arch:1,y:-5,lean:-1,blush:.7}},
 sad:{label:'슬픔',hint:'처진 눈과 고개',pose:{smile:-1,closeL:.28,closeR:.28,brow:-1,tilt:-4,y:4,lean:1.5}},
 angry:{label:'화남',hint:'눈매에 힘주기',pose:{smile:-.7,closeL:.18,closeR:.18,brow:1,lean:-1,blush:.15}},
 surprised:{label:'놀람',hint:'작은 동그란 입',pose:{mouth:.75,wide:-.45,smile:0,brow:-.3,y:-3,tilt:-2}},
 sleepy:{label:'졸림',hint:'느릿한 눈꺼풀',pose:{closeL:.85,closeR:.85,mouth:.08,tilt:5,y:3,lean:1}},
 wink:{label:'윙크',hint:'한쪽 눈으로 인사',pose:{closeL:1,closeR:.1,smile:.8,arch:.7,tilt:-5,y:-1,blush:.45}}
};
const DEFAULTS={emotion:'neutral',intensity:1,duration:650,easing:'ease-in-out',bezier:[.42,0,.58,1],breath:.65,sway:.35,hair:.35,blink:true,follow:false,talking:false,speechLevel:0,gazeX:0,gazeY:0,headTilt:0,bodyLean:0,eyeClose:0,mouthOpen:0,paused:false,reduced:false,showRig:false,selected:'head',background:'#e8efea',pivots:{root:[209,410],head:[209,317],hairL:[70,150],hairR:[350,150]}};
const copy=v=>JSON.parse(JSON.stringify(v));
const easing=(name,t,curve)=>{
 if(name==='linear')return t;
 if(name==='snappy')return 1-(1-t)**3;
 if(name==='dreamy')return (1-Math.cos(Math.PI*t))/2;
 if(name==='bouncy')return 1+2.70158*(t-1)**3+1.70158*(t-1)**2;
 if(name==='custom'){
  const [x1,y1,x2,y2]=curve, b=(u,a,c)=>3*(1-u)**2*u*a+3*(1-u)*u*u*c+u**3;
  let lo=0,hi=1;for(let i=0;i<20;i++){let m=(lo+hi)/2;b(m,x1,x2)<t?lo=m:hi=m;}return b((lo+hi)/2,y1,y2);
 }
 return t<.5?2*t*t:1-(-2*t+2)**2/2;
};
const transform=(angle,p,x=0,y=0,sx=1,sy=1)=>`translate(${x} ${y}) translate(${p[0]} ${p[1]}) rotate(${angle}) scale(${sx} ${sy}) translate(${-p[0]} ${-p[1]})`;
const make=(tag,attrs={})=>{let el=document.createElementNS(NS,tag);for(let [k,v]of Object.entries(attrs))el.setAttribute(k,v);return el;};

function createEarthRuntime(host,svgSource,onReady){
 const svg=new DOMParser().parseFromString(svgSource,'image/svg+xml').documentElement;
 if(svg.localName!=='svg'||svg.querySelector('parsererror,script,foreignObject,image'))throw Error('지원하지 않는 SVG 구조입니다.');
 const uid='earth-'+Math.random().toString(36).slice(2,9)+'-';
 const nodeMap={};svg.querySelectorAll('[id]').forEach(el=>nodeMap[el.id]=el);
 // Scope all artwork IDs per component, including clips and gradients.
 for(const el of svg.querySelectorAll('*'))for(const attr of [...el.attributes]){
  let value=attr.value.replace(/url\(#([^)]+)\)/g,(_,id)=>`url(#${uid}${id})`);
  if(attr.name==='id')value=uid+value;
  if(attr.name==='aria-labelledby')value=value.split(' ').map(x=>uid+x).join(' ');
  el.setAttribute(attr.name,value);
 }
 svg.setAttribute('aria-label','지구 캐릭터');svg.removeAttribute('aria-labelledby');
 svg.setAttribute('viewBox','-40 -38 498 488');svg.removeAttribute('width');svg.removeAttribute('height');
 svg.setAttribute('data-character','earth');
 const root=make('g',{'data-rig':'root'}),back=make('g',{'data-rig':'head-back'}),front=make('g',{'data-rig':'head'});
 back.append(nodeMap['hair-back'],nodeMap['ornaments-back']);
 front.append(nodeMap.head,nodeMap['eye-left'],nodeMap['eye-right'],nodeMap.mouth,nodeMap['hair-front']);
 root.append(back,nodeMap.body,front);svg.append(root);host.append(svg);
 const hairL=nodeMap['hair-back-left'],hairR=nodeMap['hair-back-right'];
 const defs=svg.querySelector('defs');const eyeData=[];
 for(const [side,cx] of [['left',152],['right',264]]){
  const white=nodeMap[`eye-${side}-white`],iris=nodeMap[`eye-${side}-iris`],lid=nodeMap[`eye-${side}-lid`];
  const clip=make('clipPath',{id:uid+'live-eye-'+side}),boundary=make('path');clip.append(boundary);defs.append(clip);
  const irisFrame=make('g',{'clip-path':`url(#${clip.id})`});iris.parentNode.insertBefore(irisFrame,iris);irisFrame.append(iris);
  const nums=white.getAttribute('d').match(/-?\d*\.?\d+/g).map(Number);
  eyeData.push({side,cx,white,iris,lid,boundary,nums});
 }
 const cheekLayer=make('g',{'data-effect':'blush'});for(let x of [130,287])cheekLayer.append(make('ellipse',{cx:x,cy:278,rx:15,ry:6,fill:'#f18eaa',opacity:'.3'}));
 front.insertBefore(cheekLayer,nodeMap.mouth);
 const marker=make('g',{'data-rig-marker':'true','pointer-events':'none'});
 marker.append(make('circle',{r:7,fill:'white',stroke:'#28705b','stroke-width':2}),make('path',{d:'M-12 0 L12 0 M0 -12 L0 12',stroke:'#28705b','stroke-width':1.5}));svg.append(marker);
 let options=copy(DEFAULTS),live=copy(BASE),start=copy(BASE),target=copy(BASE),elapsed=1e6,clock=0,last=0,raf=0,action=null,disposed=false;
 let transition={duration:650,easing:'ease-in-out',bezier:[.42,0,.58,1]};
 let amp=1,ampFrom=1,ampTo=1,ampTime=0,blinkTime=-1,nextBlink=3200+Math.random()*2000,gaze=[0,0],pointer=[0,0],manualSpeech=0;
 const fingerprint=d=>(d.match(/[a-z]/gi)||[]).join('');
 function mouthPath(p,speech){
  const w=6+8*Math.max(0,p.smile)+p.wide*5,open=clamp(Math.max(p.mouth,options.mouthOpen,speech));
  const x=209,y=286,curve=p.smile*6,depth=open*17;
  // Same M C C Z topology for closed, smiling, sad and speaking mouths.
  return `M${x-w} ${y} C${x-w*.45} ${y+curve-depth*.22} ${x+w*.45} ${y+curve-depth*.22} ${x+w} ${y} C${x+w*.55} ${y+curve+depth} ${x-w*.55} ${y+curve+depth} ${x-w} ${y} Z`;
 }
 function draw(dt){
  if(!options.paused){clock+=dt;elapsed+=dt;}
  const progress=clamp(elapsed/Math.max(1,transition.duration)),t=options.reduced?1:easing(transition.easing,progress,transition.bezier);
  Object.keys(BASE).forEach(k=>live[k]=mix(start[k],target[k],t));
  const wanted=progress<1?.1:1;
  if(wanted!==ampTo){ampFrom=amp;ampTo=wanted;ampTime=0;}
  if(!options.paused){ampTime+=dt;const blend=clamp(ampTime/Math.max(1,transition.duration*.4));amp=mix(ampFrom,ampTo,(1-Math.cos(Math.PI*blend))/2);}
  const motion=options.reduced?0:amp;
  if(!options.paused&&options.blink&&!options.reduced&&clock>nextBlink){blinkTime=clock;nextBlink=clock+3200+Math.random()*2600;}
  const bt=clock-blinkTime;let blink=!options.reduced&&blinkTime>=0&&bt<190?Math.sin(Math.PI*bt/190):0;
  let nod=0,shake=0,bounce=0;
  if(action){const u=clamp((clock-action.at)/action.duration),wave=Math.sin(Math.PI*u);if(action.name==='nod')nod=Math.sin(u*Math.PI*4)*5*wave;if(action.name==='shake')shake=Math.sin(u*Math.PI*6)*7*wave;if(action.name==='bounce')bounce=-22*Math.sin(Math.PI*u);if(action.name==='blink')blink=Math.max(blink,wave);if(u===1)action=null;}
  const drift=motion*Math.sin(clock/1900)*options.sway*1.2;
  const breath=motion*options.breath*.012*Math.sin(clock/950);
  root.setAttribute('transform',transform(live.lean+options.bodyLean+drift+shake,options.pivots.root,0,bounce,1,1+breath));
  const headTransform=transform(live.tilt+options.headTilt+nod*.15,options.pivots.head,0,live.y+nod,1,1-Math.abs(nod)*.002);
  back.setAttribute('transform',headTransform);front.setAttribute('transform',headTransform);
  hairL.setAttribute('transform',transform(Math.sin(clock/1350)*options.hair*2*motion,options.pivots.hairL));
  hairR.setAttribute('transform',transform(-Math.sin(clock/1350+.35)*options.hair*2*motion,options.pivots.hairR));
  const gx=clamp(options.gazeX+(options.follow?pointer[0]:0),-1,1),gy=clamp(options.gazeY+(options.follow?pointer[1]:0),-1,1);
  if(!options.paused){gaze[0]=mix(gaze[0],gx,clamp(dt/90));gaze[1]=mix(gaze[1],gy,clamp(dt/90));}
  for(const e of eyeData){
   const close=clamp(Math.max(e.side==='left'?live.closeL:live.closeR,options.eyeClose,blink));
   const coords=e.nums.map((n,i)=>i%2?mix(n,269,close):n);
   const [x1,y1,x2,y2,...c]=coords;
   const d=`M${x1} ${y1} L${x2} ${y2} C${c.slice(0,6).join(' ')} C${c.slice(6).join(' ')} Z`;
   e.white.setAttribute('d',d);e.boundary.setAttribute('d',d);
   e.iris.setAttribute('transform',`translate(${gaze[0]*5} ${gaze[1]*3})`);
   const l=e.side==='left'?107:242,r=e.side==='left'?178:311;
   const baseTop=e.side==='left'?[211,210]:[211,212],bottom=e.side==='left'?[223,221]:[222,224];
   const slope=live.brow*6*(e.side==='left'?1:-1)*(1-close),arch=live.arch*close*9;
   const ya=mix(baseTop[0],267,close)-slope,yb=mix(baseTop[1],267,close)+slope;
   const ba=Math.max(ya+2,mix(bottom[0],269,close)-slope),bb=Math.max(yb+2,mix(bottom[1],269,close)+slope);
   // Four cubic edges: no topology changes at closed-eye limits.
   e.lid.setAttribute('d',`M${l} ${ya} C${l+20} ${ya-arch} ${r-20} ${yb-arch} ${r} ${yb} C${r} ${yb} ${r} ${bb} ${r} ${bb} C${r-20} ${bb-arch} ${l+20} ${ba-arch} ${l} ${ba} C${l} ${ba} ${l} ${ya} ${l} ${ya} Z`);
   nodeMap['brow-'+e.side].setAttribute('transform',transform((e.side==='left'?1:-1)*live.brow*9,[e.side==='left'?146:257,178]));
  }
  const speak=options.talking&&!options.reduced?.18+.6*Math.abs(Math.sin(clock/110)*Math.sin(clock/173)):0;
  nodeMap.mouth.setAttribute('d',mouthPath(live,Math.max(speak,manualSpeech,options.speechLevel)));
  nodeMap.mouth.setAttribute('fill','#ba5264');
  cheekLayer.setAttribute('opacity',live.blush);
  const pivot=options.pivots[options.selected]||options.pivots.head;
  marker.setAttribute('transform',`translate(${pivot[0]} ${pivot[1]})`);marker.setAttribute('display',options.showRig?'inline':'none');
 }
 function frame(time){if(disposed)return;const dt=Math.min(48,last?time-last:16);last=time;draw(dt);raf=requestAnimationFrame(frame);}
 const api={
  configure(next){const old=options;options={...options,...next,pivots:next.pivots?copy(next.pivots):options.pivots};if(options.reduced){action=null;blinkTime=-1;}if(options.emotion!==old.emotion||options.intensity!==old.intensity||options.reduced!==old.reduced)api.transitionTo(options.emotion,options.intensity);},
  transitionTo(name,intensity=options.intensity){if(!EMOTIONS[name])return;options.emotion=name;options.intensity=clamp(intensity);start={...live};target={...BASE};for(const k in EMOTIONS[name].pose)target[k]=mix(BASE[k],EMOTIONS[name].pose[k],options.intensity);transition={duration:options.duration,easing:options.easing,bezier:[...options.bezier]};elapsed=0;},
  play(name){if(!['nod','shake','bounce','blink'].includes(name)||options.reduced||options.paused)return;action={name,at:clock,duration:name==='blink'?190:1000};},
  setSpeechLevel(v){manualSpeech=clamp(Number(v)||0);},
  reset(){options=copy(DEFAULTS);live=copy(BASE);start=copy(BASE);target=copy(BASE);elapsed=1e6;action=null;blinkTime=-1;manualSpeech=0;pointer=[0,0];gaze=[0,0];amp=ampFrom=ampTo=1;},
  setPointer(x,y){pointer=[clamp(x,-1,1),clamp(y,-1,1)];},
  snapshot(){return{options:copy(options),pose:{...live},time:clock,progress:clamp(elapsed/transition.duration),pathCount:svg.querySelectorAll('path').length,mouthTopology:fingerprint(nodeMap.mouth.getAttribute('d'))};},
  exportSVG(){const clone=svg.cloneNode(true);clone.querySelector('[data-rig-marker]').remove();clone.setAttribute('xmlns',NS);return new XMLSerializer().serializeToString(clone);},
  screenToSVG(x,y){return new DOMPoint(x,y).matrixTransform(svg.getScreenCTM().inverse());},
  getNode(id){return nodeMap[id];},
  destroy(){disposed=true;cancelAnimationFrame(raf);svg.remove();}
 };
 draw(0);raf=requestAnimationFrame(frame);onReady?.(api);return api;
}

const EarthCharacter=memo(forwardRef(function EarthCharacter({svgSource,options,onReady},ref){
 const host=useRef(null),runtime=useRef(null);
 useEffect(()=>{runtime.current=createEarthRuntime(host.current,svgSource,onReady);runtime.current.configure(options||{});return()=>runtime.current.destroy();},[svgSource]);
 useEffect(()=>{runtime.current?.configure(options||{});},[options]);
 useImperativeHandle(ref,()=>({transitionTo:(...a)=>runtime.current.transitionTo(...a),play:(...a)=>runtime.current.play(...a),setSpeechLevel:v=>runtime.current.setSpeechLevel(v),getRuntime:()=>runtime.current}),[]);
 return h('div',{className:'earth-character',ref:host});
}));

function download(name,contents,type){const url=URL.createObjectURL(new Blob([contents],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),500);}
function validateConfig(data){
 if(data?.version!==1||!data.options)throw Error('지원하는 리그 설정 파일이 아닙니다.');
 const v=data.options,result=copy(DEFAULTS);
 const limits={intensity:[0,1],duration:[100,2500],breath:[0,1],sway:[0,1],hair:[0,1],speechLevel:[0,1],gazeX:[-1,1],gazeY:[-1,1],headTilt:[-12,12],bodyLean:[-8,8],eyeClose:[0,1],mouthOpen:[0,1]};
 for(const [k,[a,b]]of Object.entries(limits))if(v[k]!==undefined){if(!Number.isFinite(v[k])||v[k]<a||v[k]>b)throw Error(k+' 값의 범위가 올바르지 않습니다.');result[k]=v[k];}
 for(const k of ['blink','follow','talking','paused','reduced','showRig'])if(typeof v[k]==='boolean')result[k]=v[k];
 if(!EMOTIONS[v.emotion])throw Error('알 수 없는 감정입니다.');result.emotion=v.emotion;
 if(['ease-in-out','linear','snappy','bouncy','dreamy','custom'].includes(v.easing))result.easing=v.easing;
 if(Array.isArray(v.bezier)&&v.bezier.length===4&&v.bezier.every(Number.isFinite)&&v.bezier.every((n,i)=>n>=(i%2?-1:0)&&n<=(i%2?2:1)))result.bezier=v.bezier;
 if(/^#[0-9a-f]{6}$/i.test(v.background))result.background=v.background;
 if(Object.hasOwn(result.pivots,v.selected))result.selected=v.selected;
 for(const k of Object.keys(result.pivots))if(v.pivots?.[k]){const p=v.pivots[k];if(!Array.isArray(p)||p.length!==2||!p.every(Number.isFinite)||p[0]<-40||p[0]>458||p[1]<-38||p[1]>450)throw Error('피벗 범위를 확인하세요.');result.pivots[k]=p;}
 return result;
}
function App(){
 const [cfg,setCfg]=useState(()=>({...copy(DEFAULTS),reduced:matchMedia('(prefers-reduced-motion: reduce)').matches}));
 const [tab,setTab]=useState('rig'),[notice,setNotice]=useState('원본 SVG에서 시작합니다.'),[ready,setReady]=useState(false);
 const ref=useRef(),file=useRef(),stage=useRef(),drag=useRef(false),runtime=useRef();
 const set=(key,value)=>setCfg(c=>({...c,[key]:value}));
 const onReady=api=>{runtime.current=api;window.earthCharacter=api;setReady(true);};
 useEffect(()=>{window.__EARTH_STUDIO__={getConfig:()=>copy(cfg),setConfig:v=>setCfg(validateConfig({version:1,options:v})),getRuntime:()=>runtime.current};},[cfg]);
 useEffect(()=>{const listener=()=>setCfg(c=>({...c,paused:document.hidden?true:c.paused}));document.addEventListener('visibilitychange',listener);return()=>document.removeEventListener('visibilitychange',listener);},[]);
 const slider=(label,key,min,max,step,unit='')=>h('label',{className:'slider-row',key},h('span',null,label,h('output',null,Number(cfg[key]).toFixed(step<1?2:0)+unit)),h('input',{type:'range',min,max,step,value:cfg[key],'aria-label':label,onChange:e=>set(key,Number(e.target.value))}));
 const toggle=(label,key)=>h('label',{className:'toggle',key},h('span',null,label),h('input',{type:'checkbox',checked:cfg[key],onChange:e=>set(key,e.target.checked)}));
 const select=(label,key,entries)=>h('label',{className:'select-row'},h('span',null,label),h('select',{'aria-label':label,value:cfg[key],onChange:e=>{const value=e.target.value;const curves={'ease-in-out':[.42,0,.58,1],linear:[0,0,1,1],snappy:[.33,1,.68,1],bouncy:[.34,1.56,.64,1],dreamy:[.37,0,.63,1]};if(key==='easing'&&curves[value])setCfg(c=>({...c,easing:value,bezier:curves[value]}));else set(key,value);}},entries.map(([v,l])=>h('option',{key:v,value:v},l))));
 const save=()=>{download('earth-rig.json',JSON.stringify({version:1,options:cfg},null,2),'application/json');setNotice('현재 리그 설정을 JSON으로 저장했습니다.');};
 const load=async e=>{try{const f=e.target.files[0];if(!f)return;if(f.size>100000)throw Error('설정 파일이 너무 큽니다.');setCfg(validateConfig(JSON.parse(await f.text())));setNotice('저장된 설정을 불러왔습니다.');}catch(err){setNotice(err.message);}finally{e.target.value='';}};
 const pointer=e=>{if(!runtime.current)return;if(drag.current){const p=runtime.current.screenToSVG(e.clientX,e.clientY);setCfg(c=>({...c,pivots:{...c.pivots,[c.selected]:[Math.round(clamp(p.x,-40,458)),Math.round(clamp(p.y,-38,450))]}}));}else{const rect=stage.current.getBoundingClientRect();runtime.current.setPointer((e.clientX-rect.left)/rect.width*2-1,(e.clientY-rect.top)/rect.height*2-1);}};
 const pivot=cfg.pivots[cfg.selected];
 return h('main',{className:'studio'},
  h('header',{className:'topbar'},h('div',{className:'brand'},h('span',{className:'brand-symbol'},'◉'),h('span',null,'EARTH',h('small',null,'CHARACTER LAB'))),h('div',{className:'header-meta'},h('span',{className:'status-dot'}),'React · Offline studio'),h('button',{className:'outline',onClick:()=>{runtime.current?.reset();setCfg(copy(DEFAULTS));setNotice('기본 리그로 돌아왔습니다.');}},'초기화')),
  h('section',{className:'intro'},h('div',null,h('p',{className:'eyebrow'},'EXPRESSION & MOTION / 01'),h('h1',null,'표정에 움직임을 더하다.'),h('p',{className:'subtitle'},'원래의 얼굴을 유지하며, 감정과 작은 동작을 조율하세요.')),h('div',{className:'intro-note'},h('span',null,'8 EMOTIONS'),h('span',null,'4 RIG ANCHORS'))),
  h('div',{className:'workspace'},h('div',{className:'preview-column'},
   h('section',{className:'stage',ref:stage,style:{background:cfg.background},onPointerMove:pointer,onPointerDown:e=>{if(cfg.showRig && !e.target.closest('button')){drag.current=true;e.currentTarget.setPointerCapture(e.pointerId);pointer(e);}},onPointerUp:e=>{drag.current=false;if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);},onPointerCancel:()=>drag.current=false,onLostPointerCapture:()=>drag.current=false,onPointerLeave:()=>{if(!drag.current)runtime.current?.setPointer(0,0);}},
    h('div',{className:'stage-top'},h('span',{className:'pill'},h('i',{className:cfg.paused?'paused':''}),cfg.paused?'PAUSED':cfg.reduced?'REDUCED MOTION':'LIVE PREVIEW'),h('span',{className:'stage-index'},'EARTH / '+cfg.emotion.toUpperCase())),
    h(EarthCharacter,{ref,svgSource:window.EARTH_SVG,options:cfg,onReady}),
    h('div',{className:'stage-footer'},h('span',null,cfg.showRig?'캔버스를 눌러 선택한 피벗을 옮기세요.':cfg.follow?'포인터를 따라 시선이 움직입니다.':'천천히 숨 쉬는, 작은 지구.'),h('button',{className:'round',onClick:()=>set('paused',!cfg.paused),'aria-label':cfg.paused?'재생':'일시정지'},cfg.paused?'▶':'Ⅱ'))),
   h('div',{className:'under-stage'},h('div',{className:'swatches'},['#e8efea','#ffffff','#202833','#f3e9df','#eee8f4','#f7e8ed'].map(color=>h('button',{key:color,title:color,'aria-label':'배경 '+color,'aria-pressed':cfg.background===color,style:{background:color},onClick:()=>set('background',color)})),h('input',{type:'color',value:cfg.background,'aria-label':'사용자 배경색',onChange:e=>set('background',e.target.value)})),h('button',{className:'text-button',onClick:()=>{download('earth-pose.svg',runtime.current.exportSVG(),'image/svg+xml');setNotice('현재 화면의 벡터 포즈를 저장했습니다.');},disabled:!ready},'현재 포즈 SVG ↗')),
   h('section',{className:'emotion-section'},h('div',{className:'section-heading'},h('h2',null,'감정 표현'),h('span',null,'전환 중에도 선택할 수 있어요')),h('div',{className:'emotions'},Object.entries(EMOTIONS).map(([id,m],i)=>h('button',{key:id,'data-emotion':id,'aria-pressed':cfg.emotion===id,className:cfg.emotion===id?'emotion active':'emotion',onClick:()=>set('emotion',id)},h('span',{className:'emotion-num'},'0'+(i+1)),h('strong',null,m.label),h('small',null,m.hint)))),slider('감정 강도','intensity',0,1,.01)),
   h('section',{className:'actions'},h('h2',null,'기본 동작'),h('div',null,[['nod','끄덕이기'],['shake','도리도리'],['bounce','바운스'],['blink','깜빡이기']].map(([id,label])=>h('button',{key:id,'data-action':id,disabled:cfg.paused||cfg.reduced,onClick:()=>ref.current.play(id)},label+' ↗')))),
  ),
  h('aside',{className:'inspector'},h('div',{className:'inspector-header'},h('span',{className:'eyebrow'},'RIG INSPECTOR'),h('h2',null,'움직임 조율')),
   h('div',{className:'tabs',role:'tablist'},[['rig','리그'],['motion','움직임'],['timing','전환']].map(([id,label])=>h('button',{key:id,role:'tab','aria-selected':tab===id,onClick:()=>setTab(id)},label))),
   h('div',{className:'controls',role:'tabpanel'},
    tab==='rig'?h(React.Fragment,null,h('h3',null,'얼굴과 자세'),slider('고개 기울기','headTilt',-12,12,.5,'°'),slider('몸 기울기','bodyLean',-8,8,.5,'°'),slider('시선 좌우','gazeX',-1,1,.05),slider('시선 상하','gazeY',-1,1,.05),slider('눈 감기','eyeClose',0,1,.01),slider('입 벌림','mouthOpen',0,1,.01),toggle('포인터 따라보기','follow'),h('div',{className:'divider'}),h('h3',null,'회전 중심점'),select('파트','selected',[['head','고개'],['root','몸 전체'],['hairL','왼쪽 뒷머리'],['hairR','오른쪽 뒷머리']]),toggle('피벗 표시 · 캔버스에서 이동','showRig'),h('div',{className:'pivot-fields'},['X','Y'].map((axis,i)=>h('label',{key:axis},axis,h('input',{type:'number','aria-label':'피벗 '+axis,value:pivot[i],min:i?-38:-40,max:i?450:458,onChange:e=>{const value=Number(e.target.value);if(Number.isFinite(value))setCfg(c=>({...c,pivots:{...c.pivots,[c.selected]:c.pivots[c.selected].map((n,j)=>j===i?clamp(value,i?-38:-40,i?450:458):n)}}));}})))),h('p',{className:'hint'},'머리는 목, 전체 호흡은 흉상 하단을 기준으로 움직입니다.')):null,
    tab==='motion'?h(React.Fragment,null,h('h3',null,'기본 움직임'),slider('호흡','breath',0,1,.01),slider('몸 흔들림','sway',0,1,.01),slider('뒷머리 흔들림','hair',0,1,.01),toggle('자연스러운 깜빡임','blink'),h('div',{className:'divider'}),h('h3',null,'말하기'),toggle('말하기 데모','talking'),slider('외부 음성 레벨','speechLevel',0,1,.01),h('p',{className:'hint'},'데모는 소리 없이 입만 움직입니다. TTS의 음량은 setSpeechLevel(0–1)로 연결할 수 있어요.'),h('div',{className:'divider'}),toggle('동작 줄이기','reduced'),h('p',{className:'hint'},'동작 줄이기는 반복 움직임을 멈추고 표정을 즉시 바꿉니다.')):null,
    tab==='timing'?h(React.Fragment,null,h('h3',null,'감정 전환'),slider('전환 시간','duration',100,2500,50,'ms'),select('이징','easing',[['ease-in-out','Ease in out · 기본'],['snappy','Snappy · 빠르게'],['bouncy','Bouncy · 탄력'],['dreamy','Dreamy · 천천히'],['linear','Linear · 일정하게'],['custom','Custom · 직접 조절']]),h('svg',{className:'curve',viewBox:'-15 -35 230 270','aria-label':'이징 곡선'},h('path',{d:'M0 200 H200 V0',fill:'none',stroke:'#bdc8c1'}),h('path',{d:`M0 200 C${cfg.bezier[0]*200} ${200-cfg.bezier[1]*200} ${cfg.bezier[2]*200} ${200-cfg.bezier[3]*200} 200 0`,fill:'none',stroke:'#32715d',strokeWidth:3})),h('p',{className:'hint'},'아래 값을 조절하면 사용자 곡선이 적용됩니다.'),['P1 X','P1 Y','P2 X','P2 Y'].map((label,i)=>h('label',{className:'slider-row',key:label},h('span',null,label,h('output',null,cfg.bezier[i].toFixed(2))),h('input',{type:'range','aria-label':label,min:i%2?-1:0,max:i%2?2:1,step:.01,value:cfg.bezier[i],onChange:e=>setCfg(c=>({...c,easing:'custom',bezier:c.bezier.map((n,j)=>i===j?Number(e.target.value):n)}))}))),h('div',{className:'divider'}),h('h3',null,'파트별 처리'),h('dl',{className:'strategies'},h('dt',null,'머리 · 몸 · 뒷머리'),h('dd',null,'TRANSFORM · 피벗 회전'),h('dt',null,'눈꺼풀 · 입'),h('dd',null,'EXACT · 베지어 보간'),h('dt',null,'홍채 · 하이라이트'),h('dd',null,'한 프레임 + 눈 영역 클리핑'),h('dt',null,'볼 홍조'),h('dd',null,'장식 레이어 · 불투명도'))):null,
   ),h('div',{className:'inspector-bottom'},h('button',{className:'primary',onClick:save},'리그 설정 저장 ↓'),h('button',{className:'outline',onClick:()=>file.current.click()},'설정 불러오기'),h('input',{ref:file,type:'file',accept:'.json,application/json',hidden:true,onChange:load}),h('p',{className:'notice',role:'status'},notice))
  )),h('footer',{className:'footer'},h('span',null,'EARTH CHARACTER LAB'),h('span',null,'원본 벡터 · React 리깅 · 오프라인 실행'))
 );
}
if(typeof window!=='undefined'){
 window.EarthCharacter=EarthCharacter;
 window.EarthRig={createEarthRuntime,EMOTIONS,DEFAULTS,validateConfig};
}
export { EarthCharacter, createEarthRuntime, EMOTIONS, DEFAULTS };
export default EarthCharacter;
