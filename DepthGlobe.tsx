// @ts-nocheck
// Converted from Framer by getframe — https://framer.com/m/DepthGlobe-prod-5cOY4e.js
// Install: npm install @react-three/drei @react-three/fiber three three-stdlib
//
// @ts-nocheck is intentional: the body is Framer's machine-generated bundle. The public
// API is typed via DepthGlobeProps below, so consumers still get IntelliSense.

import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime"
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react"
import { ACESFilmicToneMapping, BufferGeometry, Color, DirectionalLight, DoubleSide, Float32BufferAttribute, HalfFloatType, MeshStandardMaterial, ShaderMaterial, SphereGeometry, SRGBColorSpace, Vector2, Vector3, WebGLRenderer, WebGLRenderTarget } from "three"
import { OrbitControls } from "@react-three/drei"
import { Canvas, useFrame, useThree } from "@react-three/fiber"
import { EffectComposer, RenderPass, UnrealBloomPass } from "three-stdlib"
import type { CSSProperties } from "react"

export interface DepthGlobeProps {
  pointsCount?: "low" | "medium" | "high"
  preview?: boolean
  globe?: {
    scale?: number
    scaleFactor?: number
    animate?: boolean
    autoRotate?: boolean
    autoRotateSpeed?: number
    particleSize?: number
    edgeSoftness?: number
    smoothing?: number
    quality?: number
  }
  colors?: {
    backgroundColor?: string
    landColor?: string
    waterColor?: string
    blendFactor?: number
    waterOpacity?: number
  }
  glow?: {
    bloomRadius?: number
    bloomStrength?: number
    bloomThreshold?: number
  }
  light?: {
    lightColor?: string
    lightIntensity?: number
    toneMappingExposure?: number
  }
  style?: CSSProperties
}

/**
 * Depth Globe – self-contained single file.
 * Sections below are inlined from: DepthGlobeSceneContext, depthGlobeShared,
 * GlobeWebGL, PostProcessingWebGL, SceneWebGL.
 */// =============================================================================
// SECTION: Scene context (from DepthGlobeSceneContext.tsx)
// =============================================================================
// Binary format: ~4x smaller, no JSON.parse. Hosted on framer-university/components.
const GLOBE_DATA_BASE="https://cdn.jsdelivr.net/gh/framer-university/components/depth-globe-data";const BINARY_URLS={low:`${GLOBE_DATA_BASE}/globe_low.bin`,medium:`${GLOBE_DATA_BASE}/globe_medium.bin`,high:`${GLOBE_DATA_BASE}/globe_high.bin`};// JSON fallback – slower parse, larger transfer (same repo as binaries)
const JSON_FALLBACK_URLS={low:`${GLOBE_DATA_BASE}/globe_samples_10m_0.1.json`,medium:`${GLOBE_DATA_BASE}/globe_samples_10m_0.1.json`,high:`${GLOBE_DATA_BASE}/globe_samples_10m_0.1.json`};const defaultSceneState={animate:true,autoRotate:true,runAnimation:true,scale:1,backgroundColor:"#0d0d0d",landColor:"#fff0d1",waterColor:"#0d111a",blendFactor:.96,scaleFactor:.3,opacity:.81,bloomRadius:.48,bloomStrength:.6,bloomThreshold:0,lightColor:"#ffd0b8",lightIntensity:.9,toneMappingExposure:1,particleSize:1,edgeSoftness:.5,smoothing:.6,quality:1,points:null,geometryData:null};const DepthGlobeSceneContext=/*#__PURE__*/createContext(defaultSceneState);function DepthGlobeSceneProvider({value,children}){return /*#__PURE__*/_jsx(DepthGlobeSceneContext.Provider,{value:value,children:children});}function useDepthGlobeScene(){return useContext(DepthGlobeSceneContext);}// =============================================================================
// SECTION: Shared globe logic (from depthGlobeShared.ts)
// =============================================================================
const MAX_ELEVATION=6e3;const GLOBE_RADIUS=1;function coordinatesToUnitDirection(lat,lon){const phi=(90-lat)*Math.PI/180;const theta=(90-lon)*Math.PI/180;return[Math.sin(phi)*Math.cos(theta),Math.cos(phi),Math.sin(phi)*Math.sin(theta)];}function scaleElevation(elevation,scalingFactor,gamma){const t=Math.max(0,Math.min(1,elevation/MAX_ELEVATION));return Math.pow(t,gamma)*scalingFactor;}function pointGeometryShared(samples){const directions=[];const elevations=[];const landMask=[];for(const[lat,lon,elevation,land]of samples){const[dx,dy,dz]=coordinatesToUnitDirection(lat,lon);directions.push(dx,dy,dz);elevations.push(land?scaleElevation(elevation,1,1):0);landMask.push(land);}return pointGeometryFromArrays({directions:new Float32Array(directions),elevations:new Float32Array(elevations),landMask:new Float32Array(landMask)});}function pointGeometryFromArrays(data){const{directions,elevations,landMask}=data;const geometry=new BufferGeometry;geometry.setAttribute("direction",new Float32BufferAttribute(directions,3));geometry.setAttribute("elevation",new Float32BufferAttribute(elevations,1));geometry.setAttribute("land",new Float32BufferAttribute(landMask,1));geometry.setAttribute("position",new Float32BufferAttribute(new Float32Array(directions.length),3));return geometry;}const pointVertexShader=`
  attribute vec3 direction;
  attribute float elevation;
  attribute float land;
  uniform float uRadius;
  uniform float uScale;
  uniform float uTime;
  uniform float uAnimate;
  uniform float uPixelRatio;
  uniform float uParticleSize;
  uniform vec3 uCameraDelta;
  varying float vElevation;
  varying float vLand;
  varying float vPhase;
  varying vec3 vNormal;
  void main() {
    vElevation = elevation;
    vLand = land;
    vNormal = normalize(direction);
    float baseRadius = uRadius + elevation * uScale * 0.84;
    float targetRadius = uRadius + elevation * uScale;
    float distance = targetRadius - baseRadius;
    float hash = fract(sin(dot(direction, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
    float offset = fract(hash + elevation * 0.36);
    float phase = fract(uTime / 3.6 + offset);
    vPhase = phase;
    float easedT = phase * phase * (3.0 - phase * 2.1);
    float wobbleAmount = 0.006;
    float elevationWobbleScale = 1.0 + elevation * 3.0;
    vec3 wobbleAxis = normalize(
      cross(direction, vec3(0.3, 1.0, 0.3)) +
      cross(direction, vec3(1.0, 0.3, 0.3))
    );
    float wobbleSignal = sin(uTime * 3.0 + hash * 6.0);
    float wobbleEnvelope = easedT * (1.0 - easedT);
    vec3 wobble = wobbleAxis * wobbleSignal * wobbleEnvelope * wobbleAmount * elevationWobbleScale * land;
    float wobbledRadius = baseRadius + distance * easedT;
    vec3 wobbledPosition = vec3(wobbledRadius) + wobble;
    vec3 targetRadiusVec = vec3(targetRadius);
    vec3 animatedPosition = targetRadiusVec + (wobbledPosition - targetRadiusVec) * uAnimate;
    vec3 worldPosition = animatedPosition * direction;
    vec3 cameraMotion = -uCameraDelta;
    vec3 viewDir = normalize(worldPosition) + wobble * 150.0;
    vec3 lateralMotion = cameraMotion - viewDir * dot(cameraMotion, viewDir);
    float blurElevation = 0.03;
    float blurFade = 0.3;
    float elevationMask = smoothstep(blurElevation, blurElevation + blurFade, elevation);
    float blurFactor = (elevation * uScale * 9.0 + length(wobble) * uScale) * elevationMask * uAnimate;
    worldPosition += lateralMotion * blurFactor;
    vec4 mvPosition = modelViewMatrix * vec4(worldPosition, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    float baseSize = max(0.65 * uPixelRatio, 1.2 * uPixelRatio * (4.0 / -mvPosition.z));
    gl_PointSize = baseSize * uParticleSize;
  }
`;const pointFragmentShader=`
  uniform vec3 uLandColor;
  uniform vec3 uWaterColor;
  uniform float uBlendFactor;
  uniform float uTime;
  uniform float uAnimate;
  uniform float uEdgeSoftness;
  varying float vElevation;
  varying float vLand;
  varying float vPhase;
  varying vec3 vNormal;
  void main() {
    vec2 center = gl_PointCoord - vec2(0.5);
    float dist = length(center);
    if (dist > 0.5) discard;
    float fadeThreshold = 0.69;
    float rawFade = clamp((vPhase - fadeThreshold) / (1.0 - fadeThreshold), 0.0, 1.0);
    float smoothFade = rawFade * rawFade * (3.0 - rawFade * 2.0);
    float fadeMask = vElevation >= fadeThreshold ? 1.0 : 0.0;
    float fade = 1.0 - smoothFade * fadeMask * uAnimate;
    vec3 landLow = uLandColor * (1.0 - uBlendFactor) + uWaterColor * uBlendFactor;
    vec3 landElevated = landLow + (uLandColor - landLow) * vElevation;
    vec3 color = (vLand > 0.5 ? landElevated : uWaterColor) * fade;
    float softWidth = mix(0.02, 0.2 * uEdgeSoftness, vElevation);
    float alpha = 1.0 - smoothstep(0.5 - softWidth, 0.5, dist);
    if (alpha <= 0.0) discard;
    gl_FragColor = vec4(color, alpha);
  }
`;function parseColorToRgbShared(input){if(!input||input.trim()==="")return{r:0,g:0,b:0};const str=input.trim();const rgbaMatch=str.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)/i);if(rgbaMatch){return{r:Math.max(0,Math.min(255,parseFloat(rgbaMatch[1])))/255,g:Math.max(0,Math.min(255,parseFloat(rgbaMatch[2])))/255,b:Math.max(0,Math.min(255,parseFloat(rgbaMatch[3])))/255};}const hex=str.replace(/^#/,"");if(hex.length===6){return{r:parseInt(hex.slice(0,2),16)/255,g:parseInt(hex.slice(2,4),16)/255,b:parseInt(hex.slice(4,6),16)/255};}if(hex.length===3){return{r:parseInt(hex[0]+hex[0],16)/255,g:parseInt(hex[1]+hex[1],16)/255,b:parseInt(hex[2]+hex[2],16)/255};}return{r:0,g:0,b:0};}// Source passes hex to Color and uses in shader as-is (sRGB); we match that so colors aren’t darker.
function createPointsMaterial(state,pixelRatio){const landRgb=parseColorToRgbShared(state.landColor);const waterRgb=parseColorToRgbShared(state.waterColor);const landArr=[landRgb.r,landRgb.g,landRgb.b];const waterArr=[waterRgb.r,waterRgb.g,waterRgb.b];return new ShaderMaterial({transparent:true,depthWrite:true,vertexShader:pointVertexShader,fragmentShader:pointFragmentShader,uniforms:{uRadius:{value:GLOBE_RADIUS},uScale:{value:state.scaleFactor},uTime:{value:0},uAnimate:{value:state.animate?1:0},uPixelRatio:{value:pixelRatio},uParticleSize:{value:state.particleSize},uEdgeSoftness:{value:state.edgeSoftness},uCameraDelta:{value:new Vector3(0,0,0)},uLandColor:{value:landArr},uWaterColor:{value:waterArr},uBlendFactor:{value:state.blendFactor}}});}function createWaterMaterial(state){return new MeshStandardMaterial({color:new Color(state.waterColor),opacity:state.opacity,transparent:true,side:DoubleSide,depthWrite:false});}function createWaterGeometry(){return new SphereGeometry(GLOBE_RADIUS*.999,96,96);}// =============================================================================
// SECTION: GlobeWebGL component (from GlobeWebGL.tsx)
// =============================================================================
const maximumDelta=.24;const smoothResponse=6;function GlobeWebGL(){const state=useDepthGlobeScene();const{camera,gl}=useThree();const pointsRef=useRef(null);const waterRef=useRef(null);const pointsMaterialRef=useRef(null);const waterMaterialRef=useRef(null);const previousCameraPosition=useRef(new Vector3);const smoothedCameraDelta=useRef(new Vector3);const cameraDelta=useRef(new Vector3);const points=state.points;const geometryData=state.geometryData;const hasData=geometryData||points&&points.length>0;const geometry=useMemo(()=>{if(geometryData)return pointGeometryFromArrays(geometryData);if(points&&points.length>0)return pointGeometryShared(points);return null;},[geometryData,points]);const dpr=gl.getPixelRatio();const pointsMaterial=useMemo(()=>{const mat=createPointsMaterial({landColor:state.landColor,waterColor:state.waterColor,blendFactor:state.blendFactor,scaleFactor:state.scaleFactor,particleSize:state.particleSize,edgeSoftness:state.edgeSoftness,animate:state.animate},dpr);pointsMaterialRef.current=mat;return mat;},[]);const waterMaterial=useMemo(()=>{const mat=createWaterMaterial({waterColor:state.waterColor,opacity:state.opacity});waterMaterialRef.current=mat;return mat;},[]);const waterGeometry=useMemo(()=>createWaterGeometry(),[]);useEffect(()=>{pointsMaterialRef.current=pointsMaterial;waterMaterialRef.current=waterMaterial;},[pointsMaterial,waterMaterial]);useFrame((_,delta)=>{const pm=pointsMaterialRef.current;const wm=waterMaterialRef.current;if(!pm||!wm)return;const time=performance.now()*.001;pm.uniforms.uTime.value=time;pm.uniforms.uScale.value=state.scaleFactor;pm.uniforms.uAnimate.value=state.animate?1:0;pm.uniforms.uBlendFactor.value=state.blendFactor;pm.uniforms.uParticleSize.value=state.particleSize;pm.uniforms.uEdgeSoftness.value=state.edgeSoftness;const landRgb=parseColorToRgbShared(state.landColor);const waterRgb=parseColorToRgbShared(state.waterColor);pm.uniforms.uLandColor.value=[landRgb.r,landRgb.g,landRgb.b];pm.uniforms.uWaterColor.value=[waterRgb.r,waterRgb.g,waterRgb.b];if(!state.animate){smoothedCameraDelta.current.set(0,0,0);}else if(previousCameraPosition.current.lengthSq()>0){cameraDelta.current.subVectors(camera.position,previousCameraPosition.current);const clampedDelta=Math.min(delta,maximumDelta);const alpha=1-Math.exp(-smoothResponse*clampedDelta);smoothedCameraDelta.current.lerp(cameraDelta.current,alpha);smoothedCameraDelta.current.clampLength(0,maximumDelta);}pm.uniforms.uCameraDelta.value.copy(smoothedCameraDelta.current);previousCameraPosition.current.copy(camera.position);wm.color.set(state.waterColor);wm.opacity=state.opacity;});if(!geometry||!hasData){return /*#__PURE__*/_jsx("mesh",{geometry:waterGeometry,ref:waterRef,children:/*#__PURE__*/_jsx("primitive",{object:waterMaterial,attach:"material"})});}return /*#__PURE__*/_jsxs(_Fragment,{children:[/*#__PURE__*/_jsxs("points",{ref:pointsRef,rotation:[0,3.45,0],renderOrder:0,children:[/*#__PURE__*/_jsx("primitive",{object:geometry,attach:"geometry"}),/*#__PURE__*/_jsx("primitive",{object:pointsMaterial,attach:"material"})]}),/*#__PURE__*/_jsx("mesh",{geometry:waterGeometry,ref:waterRef,renderOrder:1,children:/*#__PURE__*/_jsx("primitive",{object:waterMaterial,attach:"material"})})]});}// =============================================================================
// SECTION: PostProcessingWebGL component (from PostProcessingWebGL.tsx)
// =============================================================================
function PostProcessingWebGL({children}){const{camera,gl,scene,size}=useThree();const state=useDepthGlobeScene();const composerRef=useRef(null);const bloomPassRef=useRef(null);const isTransparent=state.backgroundColor==null;useEffect(()=>{let renderTarget;if(isTransparent){renderTarget=new WebGLRenderTarget(size.width,size.height,{type:HalfFloatType,stencilBuffer:false});renderTarget.texture.colorSpace=SRGBColorSpace;}const composer=new EffectComposer(gl,renderTarget);const renderPass=new RenderPass(scene,camera);if(isTransparent){renderPass.clearAlpha=0;}composer.addPass(renderPass);const bloom=new UnrealBloomPass(new Vector2(size.width,size.height),state.bloomStrength,state.bloomRadius,state.bloomThreshold);composer.addPass(bloom);composer.setSize(size.width,size.height);composer.setPixelRatio(gl.getPixelRatio());composerRef.current=composer;bloomPassRef.current=bloom;return()=>{composer.dispose();renderTarget?.dispose();composerRef.current=null;bloomPassRef.current=null;};},[gl,scene,camera,isTransparent]);useEffect(()=>{const composer=composerRef.current;const bloom=bloomPassRef.current;if(!composer||!bloom)return;composer.setSize(size.width,size.height);composer.setPixelRatio(gl.getPixelRatio());bloom.resolution.set(size.width,size.height);},[gl,size.width,size.height]);useFrame(()=>{const composer=composerRef.current;const bloom=bloomPassRef.current;if(!composer||!bloom)return;const dpr=Math.min(window.devicePixelRatio*state.quality,8);gl.setPixelRatio(dpr);composer.setSize(size.width,size.height);composer.setPixelRatio(dpr);bloom.resolution.set(size.width,size.height);bloom.strength=state.bloomStrength;bloom.radius=state.bloomRadius;bloom.threshold=state.bloomThreshold;composer.render();},1);return /*#__PURE__*/_jsx(_Fragment,{children:children});}// =============================================================================
// SECTION: CameraController – sets camera distance based on scale
// =============================================================================
const BASE_CAMERA_DISTANCE=5.2;function CameraController(){const{camera}=useThree();const state=useDepthGlobeScene();useEffect(()=>{const scaleMult=state.scale;const distance=BASE_CAMERA_DISTANCE/scaleMult;const dir=new Vector3(0,1,5.1).normalize();camera.position.copy(dir).multiplyScalar(distance);camera.lookAt(0,0,0);},[camera,state.scale]);return null;}// =============================================================================
// SECTION: SceneWebGL component (from SceneWebGL.tsx)
// =============================================================================
function SceneWebGL(){const state=useDepthGlobeScene();const{camera,gl,invalidate,scene}=useThree();const controlsRef=useRef(null);const lightRef=useRef(null);const colorRef=useRef(new Color(state.backgroundColor??"#0d0d0d"));if(!lightRef.current){const light=new DirectionalLight("#ffffff",.6);light.position.set(0,-6,-3);lightRef.current=light;}useEffect(()=>{const light=lightRef.current;camera.add(light);scene.add(camera);return()=>{camera.remove(light);scene.remove(camera);};},[camera,scene]);useEffect(()=>{if(state.backgroundColor!=null){colorRef.current.set(state.backgroundColor);scene.background=colorRef.current;}else{scene.background=null;}},[state.backgroundColor,scene]);useEffect(()=>{gl.toneMappingExposure=state.toneMappingExposure;},[state.toneMappingExposure,gl]);useEffect(()=>{invalidate();},[state.runAnimation,state.animate,state.autoRotate,state.backgroundColor,state.landColor,state.waterColor,state.blendFactor,state.scaleFactor,state.opacity,state.bloomRadius,state.bloomStrength,state.bloomThreshold,state.lightColor,state.lightIntensity,state.toneMappingExposure,invalidate]);useFrame(()=>{if(!state.runAnimation)return;if(state.autoRotate&&controlsRef.current){controlsRef.current.update();invalidate();}else if(state.animate){invalidate();}});return /*#__PURE__*/_jsxs(_Fragment,{children:[/*#__PURE__*/_jsx(CameraController,{}),/*#__PURE__*/_jsx("ambientLight",{intensity:state.lightIntensity/2}),/*#__PURE__*/_jsx("directionalLight",{position:[1.2,0,.66],color:state.lightColor,intensity:state.lightIntensity}),/*#__PURE__*/_jsx(GlobeWebGL,{}),/*#__PURE__*/_jsx(OrbitControls,{autoRotate:state.autoRotate,autoRotateSpeed:.3,dampingFactor:.03,enablePan:false,enableZoom:false,ref:controlsRef})]});}// =============================================================================
// SECTION: Main DepthGlobe component – types, Framer props, data loading, Canvas
// =============================================================================
const INTRINSIC_WIDTH=600;const INTRINSIC_HEIGHT=400;const cssVariableRegex=/var\s*\(\s*(--[\w-]+)(?:\s*,\s*((?:[^)(]+|\((?:[^)(]+|\([^)(]*\))*\))*))?\s*\)/;function extractDefaultValue(cssVar){if(!cssVar||!cssVar.startsWith("var("))return cssVar;const match=cssVariableRegex.exec(cssVar);if(!match)return cssVar;const fallback=(match[2]||"").trim();if(fallback.startsWith("var("))return extractDefaultValue(fallback);return fallback||cssVar;}function resolveTokenColor(input){if(typeof input!=="string")return input??"#000";if(!input.startsWith("var("))return input;return extractDefaultValue(input);}/** Returns true if the color should be treated as transparent (no background). */function isTransparentColor(input){if(input==null||input.trim()==="")return true;const s=resolveTokenColor(input).trim().toLowerCase();if(s==="transparent")return true;const rgbaMatch=s.match(/rgba?\s*\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+(?:\s*,\s*([\d.]+)\s*)?\)/);if(rgbaMatch){const alpha=parseFloat(rgbaMatch[1]??"1");return alpha<.01;}return false;}function parseColorToRgb(input){if(!input||input.trim()==="")return{r:0,g:0,b:0};const str=resolveTokenColor(input).trim();const rgbaMatch=str.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)/i);if(rgbaMatch){return{r:Math.max(0,Math.min(255,parseFloat(rgbaMatch[1])))/255,g:Math.max(0,Math.min(255,parseFloat(rgbaMatch[2])))/255,b:Math.max(0,Math.min(255,parseFloat(rgbaMatch[3])))/255};}const hex=str.replace(/^#/,"");if(hex.length===6){return{r:parseInt(hex.slice(0,2),16)/255,g:parseInt(hex.slice(2,4),16)/255,b:parseInt(hex.slice(4,6),16)/255};}if(hex.length===3){return{r:parseInt(hex[0]+hex[0],16)/255,g:parseInt(hex[1]+hex[1],16)/255,b:parseInt(hex[2]+hex[2],16)/255};}return{r:0,g:0,b:0};}function mapScaleUiToMultiplier(ui){const clamped=Math.max(0,Math.min(1,ui));return clamped*.8+.2;}const defaultGlobe={scale:.9,scaleFactor:.3,animate:true,autoRotate:true,autoRotateSpeed:.3,particleSize:1,edgeSoftness:.5,smoothing:.6,quality:1};const defaultColors={backgroundColor:"#0d0d0d",landColor:"#fff0d1",waterColor:"#0d111a",blendFactor:.96,waterOpacity:.81};const defaultGlow={bloomRadius:.48,bloomStrength:.6,bloomThreshold:0};const defaultLight={lightColor:"#ffd0b8",lightIntensity:.9,toneMappingExposure:1};/**
 * @framerSupportedLayoutWidth any-prefer-fixed
 * @framerSupportedLayoutHeight any-prefer-fixed
 * @framerIntrinsicWidth 600
 * @framerIntrinsicHeight 400
 * @framerDisableUnlink
 */export default function DepthGlobe({pointsCount,preview=false,globe:globeProp,colors:colorsProp,glow:glowProp,light:lightProp,style}: DepthGlobeProps){const globe={...defaultGlobe,...globeProp};const colors=colorsProp??{};const glow={...defaultGlow,...glowProp};const light={...defaultLight,...lightProp};const scale=globe.scale??defaultGlobe.scale??.9;const scaleMultiplier=mapScaleUiToMultiplier(scale);const scaleFactor=globe.scaleFactor??defaultGlobe.scaleFactor;const animate=globe.animate??defaultGlobe.animate;const autoRotate=globe.autoRotate??defaultGlobe.autoRotate;const autoRotateSpeed=globe.autoRotateSpeed??defaultGlobe.autoRotateSpeed;const particleSize=globe.particleSize??defaultGlobe.particleSize;const edgeSoftness=globe.edgeSoftness??defaultGlobe.edgeSoftness;const smoothing=globe.smoothing??defaultGlobe.smoothing;const quality=globe.quality??defaultGlobe.quality??1;const backgroundColor=colors.backgroundColor!=null&&!isTransparentColor(colors.backgroundColor)?resolveTokenColor(colors.backgroundColor):null;const landColor=colors.landColor??defaultColors.landColor;const waterColor=colors.waterColor??defaultColors.waterColor;const blendFactor=colors.blendFactor??defaultColors.blendFactor;const waterOpacity=colors.waterOpacity??defaultColors.waterOpacity;const bloomRadius=glow.bloomRadius??defaultGlow.bloomRadius;const bloomStrength=glow.bloomStrength??defaultGlow.bloomStrength;const bloomThreshold=glow.bloomThreshold??defaultGlow.bloomThreshold;const lightColor=light.lightColor??defaultLight.lightColor;const lightIntensity=light.lightIntensity??defaultLight.lightIntensity;const toneMappingExposure=light.toneMappingExposure??defaultLight.toneMappingExposure;const containerRef=useRef(null);const globeDataRef=useRef(null);const isCanvasRef=useRef(null);if(isCanvasRef.current===null){isCanvasRef.current=false;}const isCanvas=isCanvasRef.current;const[loading,setLoading]=useState(true);const[error,setError]=useState(null);const[ready,setReady]=useState(false);const[isInView,setIsInView]=useState(true);const runAnimation=(!isCanvas||preview)&&isInView;useEffect(()=>{const el=containerRef.current;if(!el||typeof IntersectionObserver==="undefined")return;const io=new IntersectionObserver(([entry])=>setIsInView(entry.isIntersecting),{threshold:0});io.observe(el);return()=>io.disconnect();},[]);useEffect(()=>{setLoading(true);setError(null);globeDataRef.current=null;let cancelled=false;const binaryUrl=BINARY_URLS[pointsCount];const jsonUrl=JSON_FALLBACK_URLS[pointsCount];const workerCode=`
const MAX_ELEVATION = 6000;
function coordinatesToUnitDirection(lat, lon) {
  const phi = ((90 - lat) * Math.PI) / 180;
  const theta = ((90 - lon) * Math.PI) / 180;
  return [Math.sin(phi) * Math.cos(theta), Math.cos(phi), Math.sin(phi) * Math.sin(theta)];
}
function scaleElevation(elevation, scalingFactor, gamma) {
  const t = Math.max(0, Math.min(1, elevation / MAX_ELEVATION));
  return Math.pow(t, gamma) * scalingFactor;
}
self.onmessage = (e) => {
  const view = new Float32Array(e.data);
  const n = view.length / 4;
  const directions = new Float32Array(n * 3);
  const elevations = new Float32Array(n);
  const landMask = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const [dx, dy, dz] = coordinatesToUnitDirection(view[i*4], view[i*4+1]);
    directions[i*3]=dx; directions[i*3+1]=dy; directions[i*3+2]=dz;
    elevations[i] = view[i*4+3] ? scaleElevation(view[i*4+2], 1, 1) : 0;
    landMask[i] = view[i*4+3];
  }
  self.postMessage({ directions, elevations, landMask, count: n }, [directions.buffer, elevations.buffer, landMask.buffer]);
};
`;const runBinary=buffer=>{if(cancelled)return;const blob=new Blob([workerCode],{type:"application/javascript"});const worker=new Worker(URL.createObjectURL(blob));worker.onmessage=e=>{if(cancelled)return;const{directions,elevations,landMask}=e.data;globeDataRef.current={geometryData:{directions,elevations,landMask}};setError(null);setReady(true);setLoading(false);};worker.onerror=()=>{if(!cancelled){setError("Worker failed");setLoading(false);}};worker.postMessage(buffer,[buffer]);};const runJsonFallback=()=>{fetch(jsonUrl).then(res=>{if(!res.ok)throw new Error(`Failed to load: ${res.statusText}`);return res.json();}).then(data=>{if(cancelled)return;if(!data.points||!Array.isArray(data.points)){setError("Invalid data: expected { points: [...] }");setLoading(false);return;}globeDataRef.current={points:data.points};setError(null);setReady(true);setLoading(false);}).catch(err=>{if(!cancelled){setError(err?.message??"Failed to load globe data");setLoading(false);}});};fetch(binaryUrl).then(res=>{if(cancelled)return;if(res.ok)return res.arrayBuffer();return null;}).then(buffer=>{if(cancelled)return;if(buffer)runBinary(buffer);else runJsonFallback();}).catch(()=>runJsonFallback());return()=>{cancelled=true;};},[pointsCount,isCanvas]);if(error){return /*#__PURE__*/_jsx("div",{style:{...style,position:"absolute",inset:0,width:"100%",height:"100%",display:"flex",alignItems:"center",justifyContent:"center",padding:16,margin:0,background:"#0d0d0d",color:"#888",fontSize:14},children:error});}const data=globeDataRef.current;const sceneState={animate,autoRotate,runAnimation,scale:scaleMultiplier,backgroundColor,landColor:resolveTokenColor(landColor),waterColor:resolveTokenColor(waterColor),blendFactor,scaleFactor,opacity:waterOpacity,bloomRadius,bloomStrength,bloomThreshold,lightColor:resolveTokenColor(lightColor),lightIntensity,toneMappingExposure,particleSize,edgeSoftness,smoothing,quality,points:data&&"points"in data?data.points:null,geometryData:data&&"geometryData"in data?data.geometryData:null};return /*#__PURE__*/_jsxs("div",{ref:containerRef,style:{...style,position:"relative",width:"100%",height:"100%",minHeight:0,minWidth:0,overflow:"hidden",boxSizing:"border-box",display:"block",margin:0,padding:0,background:backgroundColor!=null?resolveTokenColor(backgroundColor):"transparent"},children:[/*#__PURE__*/_jsx("div",{style:{width:`${INTRINSIC_WIDTH}px`,height:`${INTRINSIC_HEIGHT}px`,minWidth:`${INTRINSIC_WIDTH}px`,minHeight:`${INTRINSIC_HEIGHT}px`,visibility:"hidden",position:"absolute",inset:0,zIndex:-1,pointerEvents:"none"},"aria-hidden":"true"}),ready&&/*#__PURE__*/_jsx("div",{style:{position:"absolute",inset:0,width:"100%",height:"100%",display:"block",minHeight:0,minWidth:0},children:/*#__PURE__*/_jsx(Canvas,{camera:{position:[0,1,5.1],fov:30},frameloop:"demand",flat:true,resize:{offsetSize:true},gl:canvas=>{const renderer=new WebGLRenderer({canvas,antialias:true,alpha:true,powerPreference:"high-performance"});renderer.setClearColor(0,0);renderer.toneMapping=ACESFilmicToneMapping;renderer.toneMappingExposure=1;renderer.outputColorSpace=SRGBColorSpace;const dpr=Math.min(window.devicePixelRatio*quality,8);renderer.setPixelRatio(dpr);return renderer;},style:{position:"absolute",inset:0,width:"100%",height:"100%",display:"block"},children:/*#__PURE__*/_jsx(DepthGlobeSceneProvider,{value:sceneState,children:backgroundColor==null?/*#__PURE__*/_jsx(SceneWebGL,{}):/*#__PURE__*/_jsx(PostProcessingWebGL,{children:/*#__PURE__*/_jsx(SceneWebGL,{})})})})})]});}// =============================================================================
// SECTION: Property controls
// =============================================================================
DepthGlobe.displayName="Depth Globe";
