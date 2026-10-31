/** This file describes semantic IR, never any source binary layout. */
export type Vec2 = [number, number];
export type Vec3 = [number, number, number];
export type Vec4 = [number, number, number, number];
export type Inheritance = 'normal'|'only_translation'|'no_rotation_or_reflection'|'no_scale'|'no_scale_or_reflection';
export type Blend = 'normal'|'additive'|'multiply'|'screen';
export type Transform = { x:number;y:number;rotationDeg:number;scaleX:number;scaleY:number;shearXDeg:number;shearYDeg:number;length:number };
export type Bone = {id:string;parentId:string|null;setup:Transform;inheritance:Inheritance;skinRequired:boolean};
export type Slot = {id:string;boneId:string;drawIndex:number;light:Vec4;dark:Vec3|null;setupAttachmentId:string|null;blend:Blend};
export type Influence = {boneId:string;x:number;y:number;weight:number};
export type Vertex = {position:Vec2|null; influences:Influence[]};
export type Sequence = {count:number;start:number;digits:number;setupIndex:number;mode?:string;basePath?:string};
type AttachmentBase = {id:string;name:string;color:Vec4};
export type RegionAttachment = AttachmentBase & {kind:'region';regionId:string;local:Transform;width:number;height:number;sequence:Sequence|null};
export type MeshAttachment = AttachmentBase & {kind:'mesh';regionId:string;uvs:number[];triangles:number[];vertices:Vertex[];hullVertexCount:number;sequence:Sequence|null};
export type LinkedMeshAttachment = AttachmentBase & {kind:'linked_mesh';parentMeshId:string;regionId:string;deformTimelineOwnerId:string;inheritDeform:boolean;sequence:Sequence|null};
export type PolygonAttachment = AttachmentBase & ({kind:'clipping';endSlotId:string;vertices:Vertex[]} | {kind:'bounding_box';vertices:Vertex[]} | {kind:'path';vertices:Vertex[];closed:boolean;constantSpeed:boolean;lengths:number[]});
export type PointAttachment = AttachmentBase & {kind:'point';x:number;y:number;rotationDeg:number};
export type Attachment = RegionAttachment|MeshAttachment|LinkedMeshAttachment|PolygonAttachment|PointAttachment;
export type Skin = {id:string;isDefault:boolean;attachments:{slotId:string;key:string;attachmentId:string}[];activeBoneIds:string[];activeConstraintIds:string[]};
export type Constraint = {id:string;kind:'ik'|'transform'|'path';order:number;activeInDefaultSkin?:boolean;boneIds:string[];targetBoneId:string|null;targetSlotId:string|null;parameters:Record<string, number|boolean|string>};
export type EventDefinition = {id:string;name:string;int?:number;float?:number;string?:string|null;audio?:string|null;volume?:number;balance?:number};
/** The interpolation curve is independent of the value payload. When a vector
 * has one Bezier, that fraction is shared by every numeric component. */
export type Interpolation = {kind:'linear'|'stepped'|'cubic_bezier';bezierByChannel?:Vec4[];sampling?:'polyline10'};
export type Keyframe = {timeSec:number;value:unknown;interpolation:Interpolation};
export type Timeline = {targetKind:'bone'|'slot'|'attachment'|'constraint'|'skeleton'|'event';targetId:string|null;property:string;deformBasis:'none'|'vertex_delta'|'influence_delta';keys:Keyframe[]};
export type Animation = {id:string;name:string;durationSec:number;timelines:Timeline[]};
export type AtlasPage = {id:string;path:string;width:number;height:number;minFilter?:string;magFilter?:string;wrapU?:string;wrapV?:string;pma:boolean;scale:number};
export type AtlasRegion = {id:string;name:string;pageId:string;bounds:Vec4;originalSize:Vec2;offset:Vec2;rotationDeg:0|90|180|270;sequenceIndex?:number|null};
export type AuthoringData={fps:number;imagesPath:string|null;audioPath:string|null;boneColors:Record<string,number>;attachmentMetadata:Record<string,{color?:number;edges?:number[];width?:number;height?:number}>};
export type IRDocument = {
 authoringData?:AuthoringData;
 format:'universal-skeleton-ir';schemaVersion:string;
 source:{family:string;version:string;sha256:string;adapter:string;adapterVersion:string};
 conventions:{axes:'x-right-y-up';time:'seconds';angles:'degrees';uvOrigin:'top-left'|'bottom-left';color:'straight-srgba'|'premultiplied-srgba'|'straight-linear'|'premultiplied-linear';unitsPerPixel:number};
 capabilities:string[];
 atlases:{pages:AtlasPage[];regions:AtlasRegion[]};
 skeleton:{bounds:Vec4|null;bones:Bone[];slots:Slot[];skins:Skin[];attachments:Attachment[];constraints:Constraint[];events:EventDefinition[];animations:Animation[]};
};
export const DEFAULT_TRANSFORM: Transform = {x:0,y:0,rotationDeg:0,scaleX:1,scaleY:1,shearXDeg:0,shearYDeg:0,length:0};
export function copyTransform(value:Transform):Transform{return {...value};}
