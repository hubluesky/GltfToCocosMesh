import { Attribute, FormatInfos, getIndexStrideCtor, getOffset, getReader, getTypedArrayConstructor, ISubMesh, IVertexBundle, TypedArray } from "./Cocos";
import { Vec3 } from "./Vec3";

export class CocosMeshMeta {
    public readonly primitives: ISubMesh[];
    public readonly vertexBundles: IVertexBundle[];
    public readonly jointMaps?: number[][];
    public set minPosition(v: Vec3) {
        const minPositionArray: number[] = this.getBin()[3];
        minPositionArray[1] = v.x;
        minPositionArray[2] = v.y;
        minPositionArray[3] = v.z;
    }
    public set maxPosition(v: Vec3) {
        const maxPositionArray: number[] = this.getBin()[6];
        maxPositionArray[1] = v.x;
        maxPositionArray[2] = v.y;
        maxPositionArray[3] = v.z;
    }

    private _data: any;
    public get data() { return this._data; }

    private getBin() { return this.data[5][0][3]; }

    public constructor(jsonText: string) {
        this._data = JSON.parse(jsonText);
        const bin = this.getBin()[0];
        this.primitives = bin["primitives"];
        this.vertexBundles = bin["vertexBundles"];
        this.jointMaps = bin["jointMaps"];
    }
}

interface AttributeValue {
    attribute: Attribute;
    data: TypedArray;
}

interface VertexBundle {
    readonly attributeValues: AttributeValue[];
}

export default class CocosMesh {
    public readonly bundles: VertexBundle[] = [];
    public readonly primitives: TypedArray[] = [];

    public constructor(arrayBuffer: ArrayBuffer, meshMeta: CocosMeshMeta) {
        for (let iv = 0; iv < meshMeta.vertexBundles.length; iv++) {
            const vertexBundle = meshMeta.vertexBundles[iv];
            this.bundles[iv] = { attributeValues: [] };
            for (let ia = 0; ia < vertexBundle.attributes.length; ia++) {
                const view = new DataView(arrayBuffer, vertexBundle.view.offset + getOffset(vertexBundle.attributes, ia));
                const { format } = vertexBundle.attributes[ia];
                const reader = getReader(view, format)!;
                console.assert(reader != null);
                const vertexCount = vertexBundle.view.count;
                const inputStride = vertexBundle.view.stride;
                const componentCount = FormatInfos[format].count;

                const StorageConstructor = getTypedArrayConstructor(FormatInfos[format]);
                const storage = new StorageConstructor(vertexCount * componentCount);
                this.bundles[iv].attributeValues[ia] = { attribute: vertexBundle.attributes[ia], data: storage };
                for (let iVertex = 0; iVertex < vertexCount; iVertex++) {
                    for (let iComponent = 0; iComponent < componentCount; iComponent++) {
                        storage[componentCount * iVertex + iComponent] = reader(inputStride * iVertex + storage.BYTES_PER_ELEMENT * iComponent);
                    }
                }

            }
        }

        for (const primitive of meshMeta.primitives) {
            const indexView = primitive.indexView!;
            const Ctor = getIndexStrideCtor(indexView.stride);
            const ibo = new Ctor(arrayBuffer, indexView.offset, indexView.count);
            this.primitives.push(ibo);
        }
    }
}