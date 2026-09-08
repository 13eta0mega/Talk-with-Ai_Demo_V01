"use client";
import React, {useRef, useState} from 'react';
import EarthCharacter, {DEFAULTS} from './EarthCharacter.jsx';
import './studio.css';

// Pass the original SVG text, e.g. a Vite `?raw` import or a bundled string.
// import svgSource from './earth_character.svg?raw';
export default function ReactExample({svgSource}) {
  const character=useRef(null);
  const [emotion,setEmotion]=useState('neutral');
  const [speaking,setSpeaking]=useState(false);
  return <section>
    <div style={{width:420,height:450,background:'#e8efea'}}>
      <EarthCharacter ref={character} svgSource={svgSource}
        options={{...DEFAULTS,emotion,talking:speaking}} />
    </div>
    <button onClick={()=>setEmotion('happy')}>기쁨</button>
    <button onClick={()=>setEmotion('sad')}>슬픔</button>
    <button onClick={()=>character.current.play('nod')}>끄덕이기</button>
    <button onClick={()=>setSpeaking(v=>!v)}>말하기 데모</button>
  </section>;
}

// TTS amplitude, supplied by your audio pipeline:
// character.current.setSpeechLevel(rmsEnvelope); // 0..1; call with 0 on stop.
// Interruptible imperative transition:
// character.current.transitionTo('wink', 0.8);
// A controlled `options.emotion` should remain the source of truth if used.
