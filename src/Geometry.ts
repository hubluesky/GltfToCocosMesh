import { ReadonlyVec3, vec2, vec3, vec4 } from "gl-matrix";
import { AttributeName } from "./Cocos";
import { BoundingBox, GLTF, glTFLoaderBasic, MeshPrimitive } from "./glTFLoader";

export type TypeArray = Int8Array | Uint8Array | Int16Array | Uint16Array | Int32Array | Uint32Array | Float32Array;

type GltfPrimitiveKeys = keyof MeshPrimitive["attributes"];
const gltfAttributeMaps: Record<GltfPrimitiveKeys, AttributeName | null> = {
    "POSITION": AttributeName.ATTR_POSITION,
    "NORMAL": AttributeName.ATTR_NORMAL,
    "TANGENT": AttributeName.ATTR_TANGENT,
    "TEXCOORD_0": AttributeName.ATTR_TEX_COORD,
    "TEXCOORD_1": AttributeName.ATTR_TEX_COORD1,
    "TEXCOORD_2": AttributeName.ATTR_TEX_COORD2,
    "COLOR_0": AttributeName.ATTR_COLOR,
    "JOINTS_0": AttributeName.ATTR_JOINTS,
    "WEIGHTS_0": AttributeName.ATTR_WEIGHTS,
};

interface PrimitiveData {
    readonly indices?: TypeArray;
    readonly joints?: number[];
    readonly attributeDatas: AttributeData[];
    readonly boundingBox?: BoundingBox;
}

interface AttributeData {
    name: AttributeName;
    data: TypeArray;
}

export default class Geometry {
    public readonly primitiveDatas: PrimitiveData[] = [];

    public static creatFromGLTF(gltf: GLTF): Geometry {
        if (gltf.meshes.length > 1) throw `Multiple Mesh is not supported.`;
        const mesh = gltf.meshes[0];
        const geometry = new Geometry();
        const joints: number[] = gltf.skins == null || gltf.skins.length == 0 ? null : gltf.skins[0].joints.map(x => x.nodeID);
        for (const primitive of mesh.primitives) {
            const indices = glTFLoaderBasic.accessorToTypeArray(primitive.indices);
            const primitiveData: PrimitiveData = { attributeDatas: [], indices, joints, boundingBox: primitive.boundingBox };
            geometry.primitiveDatas.push(primitiveData);
            for (const key in primitive.attributes) {
                const type = gltfAttributeMaps[key as GltfPrimitiveKeys];
                const accessor = primitive.attributes[key as GltfPrimitiveKeys];
                const data = glTFLoaderBasic.accessorToTypeArray(accessor);
                primitiveData.attributeDatas.push({ name: type, data });
            }
        }
        return geometry;
    }

    public getBoundPositions(): { boundMin: ReadonlyVec3, boundMax: ReadonlyVec3 } {
        let boundMin = vec3.fromValues(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);
        let boundMax = vec3.fromValues(Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY);
        for (let primitive of this.primitiveDatas) {
            if (primitive.boundingBox != null) {
                boundMin = vec3.min(boundMin, boundMin, primitive.boundingBox.min);
                boundMax = vec3.max(boundMax, boundMax, primitive.boundingBox.max);
            } else {
                const typeArray = primitive.attributeDatas.find(x => x.name == AttributeName.ATTR_POSITION).data;
                for (let i = 0; i < typeArray.length; i += 3) {
                    const position = Geometry.createVector3(typeArray, i, vec3.create());
                    boundMin = vec3.min(boundMin, boundMin, position);
                    boundMax = vec3.max(boundMax, boundMax, position);
                }
            }
        }
        return { boundMin, boundMax };
    }

    public getAttributeAccessor(indexPrimitive: number, attributeName: AttributeName): TypeArray {
        let attributeData = this.primitiveDatas[indexPrimitive].attributeDatas.find(x => x.name == attributeName);

        if (attributeData == null) {
            switch (attributeName) {
                case AttributeName.ATTR_NORMAL: {
                    const data = this.createNormalTypeArray(indexPrimitive);
                    attributeData = { name: attributeName, data };
                    this.primitiveDatas[indexPrimitive].attributeDatas.push(attributeData);
                } break;
                case AttributeName.ATTR_TANGENT: {
                    let typeArray = this.primitiveDatas[indexPrimitive].attributeDatas.find(x => x.name == AttributeName.ATTR_NORMAL).data;
                    if (typeArray == null)
                        typeArray = this.getAttributeAccessor(indexPrimitive, AttributeName.ATTR_NORMAL);

                    const data = this.createTangentAccessor(indexPrimitive, typeArray);
                    attributeData = { name: attributeName, data };
                    this.primitiveDatas[indexPrimitive].attributeDatas.push(attributeData);
                } break;
                default:
                    throw new Error(`The ${attributeName} is not supported.`);
            }
        }

        return attributeData.data;
    }

    public createNormalTypeArray(indexPrimitive: number): TypeArray {
        const normalList = Geometry.computeNormals(this.primitiveDatas[indexPrimitive]);
        const componentCount = 3;
        const typeArray = new Float32Array(new ArrayBuffer(normalList.length * componentCount * Float32Array.BYTES_PER_ELEMENT));
        for (let i = 0; i < normalList.length; i++) {
            const normal = normalList[i];
            typeArray[i * componentCount + 0] = normal[0];
            typeArray[i * componentCount + 1] = normal[1];
            typeArray[i * componentCount + 2] = normal[2];
        }
        return typeArray;
    }

    public createTangentAccessor(indexPrimitive: number, normalArray: TypeArray): TypeArray {
        const tangentList = Geometry.computeTangents(this.primitiveDatas[indexPrimitive], normalArray);
        const componentCount = 4;
        const typeArray = new Float32Array(new ArrayBuffer(tangentList.length * componentCount * Float32Array.BYTES_PER_ELEMENT));
        for (let i = 0; i < tangentList.length; i++) {
            const tangent = tangentList[i];
            typeArray[i * componentCount + 0] = tangent[0];
            typeArray[i * componentCount + 1] = tangent[1];
            typeArray[i * componentCount + 2] = tangent[2];
            typeArray[i * componentCount + 3] = tangent[3];
        }
        return typeArray;
    }

    public static createVector2(array: TypeArray, index: number, out: vec2): vec2 {
        index *= 2;
        return vec2.set(out, array[index], array[index + 1]);
    }

    public static createVector3(array: TypeArray, index: number, out: vec3): vec3 {
        index *= 3;
        return vec3.set(out, array[index], array[index + 1], array[index + 2]);
    }

    public static computeNormals(primitiveData: PrimitiveData): vec3[] {
        const normalList: vec3[] = [];

        const positionArray = primitiveData.attributeDatas.find(x => x.name == AttributeName.ATTR_POSITION).data;
        const vertexCount = positionArray.length / 3;
        for (let i = 0; i < vertexCount; i++)
            normalList.push(vec3.create());

        const indicesArray = primitiveData.indices;

        const vec3Temp1 = vec3.create();
        const vec3Temp2 = vec3.create();
        const vec3Temp3 = vec3.create();
        const vec3Temp4 = vec3.create();
        const vec3Temp5 = vec3.create();
        const vec3Temp6 = vec3.create();

        for (let i = 0; i < indicesArray.length; i += 3) {
            const index1 = indicesArray[i + 0];
            const index2 = indicesArray[i + 1];
            const index3 = indicesArray[i + 2];

            const vertex1 = Geometry.createVector3(positionArray, index1, vec3Temp4);
            const vertex2 = Geometry.createVector3(positionArray, index2, vec3Temp5);
            const vertex3 = Geometry.createVector3(positionArray, index3, vec3Temp6);

            const dir1 = vec3.subtract(vec3Temp1, vertex2, vertex1);
            const dir2 = vec3.subtract(vec3Temp2, vertex3, vertex1);
            const dir3 = vec3.cross(vec3Temp3, dir1, dir2);

            vec3.add(normalList[index1], normalList[index1], dir3);
            vec3.add(normalList[index2], normalList[index2], dir3);
            vec3.add(normalList[index3], normalList[index3], dir3);
        }

        for (const normal of normalList)
            vec3.normalize(normal, normal);

        return normalList;
    }

    public static computeTangents(primitiveData: PrimitiveData, normalArray: TypeArray): vec4[] {
        const tan1: vec3[] = [];
        const tan2: vec3[] = [];

        const vec2Temp1 = vec2.create();
        const vec2Temp2 = vec2.create();
        const vec2Temp3 = vec2.create();

        const vec3Temp1 = vec3.create();
        const vec3Temp2 = vec3.create();
        const vec3Temp3 = vec3.create();
        const vec3Temp4 = vec3.create();
        const vec3Temp5 = vec3.create();

        const positionArray = primitiveData.attributeDatas.find(x => x.name == AttributeName.ATTR_POSITION).data;
        const vertexCount = positionArray.length / 3;
        for (let i = 0; i < vertexCount; i++) {
            tan1.push(vec3.create());
            tan2.push(vec3.create());
        }

        const indicesArray = primitiveData.indices;
        const coordArray = primitiveData.attributeDatas.find(x => x.name == AttributeName.ATTR_TEX_COORD).data;

        const triangleCount = indicesArray.length / 3;
        for (let i = 0; i < triangleCount; i++) {
            const index1 = indicesArray[i * 3 + 0];
            const index2 = indicesArray[i * 3 + 1];
            const index3 = indicesArray[i * 3 + 2];

            const vertex1 = Geometry.createVector3(positionArray, index1, vec3Temp1);
            const vertex2 = Geometry.createVector3(positionArray, index2, vec3Temp2);
            const vertex3 = Geometry.createVector3(positionArray, index3, vec3Temp3);

            const texcoord1 = Geometry.createVector2(coordArray, index1, vec2Temp1);
            const texcoord2 = Geometry.createVector2(coordArray, index2, vec2Temp2);
            const texcoord3 = Geometry.createVector2(coordArray, index3, vec2Temp3);

            const dir1 = vec3.subtract(vertex2, vertex2, vertex1);
            const dir2 = vec3.subtract(vertex3, vertex3, vertex1);

            const uv1 = vec2.subtract(texcoord2, texcoord2, texcoord1);
            const uv2 = vec2.subtract(texcoord3, texcoord3, texcoord1);

            const r = 1.0 / (uv1[0] * uv2[1] - uv2[0] * uv1[1]);

            if (!isFinite(r)) {
                // console.warn(uv1, uv2);
                continue;
            }

            const sdir = vec3.scale(vec3Temp4, dir1, uv2[1]);
            vec3.scaleAndAdd(sdir, sdir, dir2, -uv1[1]);
            vec3.scale(sdir, sdir, r);

            const tdir = vec3.scale(vec3Temp5, dir2, uv1[0]);
            vec3.scaleAndAdd(tdir, tdir, dir1, -uv2[0]);
            vec3.scale(tdir, tdir, r);

            vec3.add(tan1[index1], tan1[index1], sdir);
            vec3.add(tan1[index2], tan1[index2], sdir);
            vec3.add(tan1[index3], tan1[index3], sdir);

            vec3.add(tan2[index1], tan2[index1], tdir);
            vec3.add(tan2[index2], tan2[index2], tdir);
            vec3.add(tan2[index3], tan2[index3], tdir);
        }

        const tangentList: vec4[] = [];
        for (let i = 0; i < vertexCount; i++) {
            const normal = Geometry.createVector3(normalArray, i, vec3Temp1);
            vec3.normalize(normal, normal);
            const normal2 = vec3.clone(normal);
            const t = tan1[i];
            // Gram-Schmidt orthogonalize
            const temp = vec3.clone(t);
            vec3.scale(normal, normal, vec3.dot(normal, t));
            vec3.subtract(temp, temp, normal);
            vec3.normalize(temp, temp);
            // Calculate handedness
            const temp2 = vec3.cross(vec3Temp2, normal2, t);
            const test = vec3.dot(temp2, tan2[i]);
            const w = (test < 0.0) ? 1.0 : 1.0;
            tangentList[i] = vec4.fromValues(temp[0], temp[1], temp[2], w);
        }

        return tangentList;
    }
}