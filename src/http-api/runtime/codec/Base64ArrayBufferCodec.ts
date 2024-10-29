import { Codec } from "./Codec"

export class Base64ArrayBufferCodec extends Codec<ArrayBuffer, string> {
  encode(buffer: ArrayBuffer): string {
    const uint8Array = new Uint8Array(buffer)
    let binaryString = ""
    for (const byte of uint8Array) {
      binaryString += String.fromCharCode(byte)
    }
    return btoa(binaryString)
  }

  decode(base64: string): ArrayBuffer {
    const binaryString = atob(base64)
    const len = binaryString.length
    const buffer = new ArrayBuffer(len)
    const uint8Array = new Uint8Array(buffer)
    for (let i = 0; i < len; i++) {
      uint8Array[i] = binaryString.charCodeAt(i)
    }
    return buffer
  }
}
