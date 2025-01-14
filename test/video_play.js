var webglPlayer, canvas, videoWidth, videoHeight, yLength, uvLength;
var LOG_LEVEL_JS = 0;
var LOG_LEVEL_WASM = 1;
var LOG_LEVEL_FFMPEG = 2;
var DECODER_H264 = 0;
var DECODER_H265 = 1;

var decoder_type = DECODER_H265;

var needStop;
var file_list;
var file_idx;

function play() {
    needStop = false
    file_idx = 0;
    decode_seq(file_list, file_idx);
}

function handleVideoFiles(files, type) {
    decoder_type = type;
    file_list = files;
    // file_idx = 0;
    // decode_seq(file_list, file_idx);
}

async function decode_seq(file_list, file_idx) {
    if (file_idx >= file_list.length)
        return;
    var file = file_list[file_idx];
    var start_time = new Date();

    var buffer = []

    var videoSize = 0;
    var videoCallback = Module.addFunction(function (addr_y, addr_u, addr_v, stride_y, stride_u, stride_v, width, height, pts) {
        // console.log("[%d]In video callback, size = %d * %d, pts = %d", ++videoSize, width, height, pts)
        let size = width * height + (width / 2)  * (height / 2) + (width / 2)  * (height / 2)
        let data = new Uint8Array(size)
        let pos = 0
        for(let i=0; i< height; i++) {
            let src = addr_y + i * stride_y
            let tmp = HEAPU8.subarray(src, src + width)
            tmp = new Uint8Array(tmp)
            data.set(tmp, pos)
            pos += tmp.length
        }
        for(let i=0; i< height / 2; i++) {
            let src = addr_u + i * stride_u
            let tmp = HEAPU8.subarray(src, src + width / 2)
            tmp = new Uint8Array(tmp)
            data.set(tmp, pos)
            pos += tmp.length
        }
        for(let i=0; i< height / 2; i++) {
            let src = addr_v + i * stride_v
            let tmp = HEAPU8.subarray(src, src + width / 2)
            tmp = new Uint8Array(tmp)
            data.set(tmp, pos)
            pos += tmp.length
        }
        var obj = {
            data: data,
            width,
            height
        }
        buffer.push(obj)
    });
    var play = () => {
        if (buffer.length > 0) {
            var o = buffer.shift()
            displayVideoFrame(o)
            displayVideoFrame2(o)
        }
        if (!needStop) {
            setTimeout(() => {
                play()
            }, 30);
        }
    }
    if (!needStop) {
        play()
    }

    var ret = Module._openDecoder(decoder_type, videoCallback, LOG_LEVEL_WASM)
    if(ret == 0) {
        console.log("openDecoder success");
    } else {
        console.error("openDecoder failed with error", ret);
        return;
    }

    var readerIndex = 0
    var CHUNK_SIZE = 128;
    var i_stream_size = 0;
    var filePos = 0;
    var totalSize = 0
    var pts = 0

    var reader = new FileReader()
    reader.addEventListener('load', e => {
        // console.log('on load:', e, file)
        if (needStop) {
            return
        }
        var typedArray = new Uint8Array(e.target.result);
        var size = typedArray.length
        var cacheBuffer = Module._malloc(size);
        Module.HEAPU8.set(typedArray, cacheBuffer);
        // console.log("[" + (++readerIndex) + "] Read len = ", size + ", Total size = " + totalSize)

        Module._decodeData(cacheBuffer, size, pts++)
        if (cacheBuffer != null) {
            Module._free(cacheBuffer);
            cacheBuffer = null;
        }
        if(size < CHUNK_SIZE || filePos >= file.size) {
            console.log('Flush frame data')
            Module._flushDecoder();
            Module._closeDecoder();
        }
        if (needStop) {
            return
        }
        var rf = () => {
            if (buffer.length > 2) {
                setTimeout(rf, 10);
            } else {
                var n = readFile(reader, file, filePos, CHUNK_SIZE)
                filePos += n
            }
        }
        rf()
    })
    var n = readFile(reader, file, filePos, CHUNK_SIZE)
    filePos += n

}

function readFile(reader, file, offset, chunkSize) {
    var end = offset + chunkSize
    var total = file.size
    if (end > total) {
        end = total
    }
    if (end <= offset) {
        return 0
    }
    var s
    if (file.slice) {
        s = file.slice(offset, end)
    } else if (file.mozSlice) {
        s = file.mozSlice(offset, end)
    } else if (file.webkitSlice) {
        s = file.webkitSlice(offset, end)
    } else {
        return 0
    }
    reader.readAsArrayBuffer(s)
    return end - offset
}

function displayVideoFrame(obj) {
    var data = new Uint8Array(obj.data);
    var width = obj.width;
    var height = obj.height;
    var yLength = width * height;
    var uvLength = (width / 2) * (height / 2);
    if(!webglPlayer) {
        const canvasId = "playCanvas";
        canvas = document.getElementById(canvasId);
        webglPlayer = new WebGLPlayer(canvas, {
            preserveDrawingBuffer: false
        });
    }
    webglPlayer.renderFrame(data, width, height, yLength, uvLength);
}

var tm = 0
async function displayVideoFrame2(obj) {
    var now = Number(new Date())
    if (!tm) {
        tm = now
    }
    // console.log('display:', now - tm, obj)
    canvas = document.getElementById('playCanvas2')
    const oc = canvas.getContext('2d')
    const img = new ImageData(obj.width, obj.height)
    console.log('img:', img)
    const len = obj.width * obj.height
    const hWidth = obj.width / 2
    const uStart = len
    const vStart = len + len / 4
    // for (let i = 0; i < len; i++) {
    //     const y = obj.data[i]
    //     const u = obj.data[uStart + (i>>2)]
    //     const v = obj.data[vStart + (i>>2)]
    //     img.data[(i << 2) + 0] = y
    //     img.data[(i << 2) + 1] = u
    //     img.data[(i << 2) + 2] = v
    //     img.data[(i << 2) + 3] = 0xff
    // }
    for (let j = 0; j < obj.height; j++) {
        for (let i = 0; i < obj.width; i++) {
            const idx = j * obj.width + i
            const idxRgb = idx << 2
            const y = obj.data[idx]
            const u = obj.data[uStart + (j>>1) * hWidth + (i>>1)]
            const v = obj.data[vStart + (j>>1) * hWidth + (i>>1)]
            let r = y + 1.402 * (v - 128)
            let g = y - 0.34413 * (u - 128) - 0.71414*(v - 128)
            let b = y + 1.772 * (u - 128)
            if (r < 0) r = 0
            if (g < 0) g = 0
            if (b < 0) b = 0
            if (r > 255) r = 255
            if (g > 255) g = 255
            if (b > 255) b = 255
            img.data[idxRgb + 0] = r
            img.data[idxRgb + 1] = g
            img.data[idxRgb + 2] = b
            img.data[idxRgb + 3] = 0xff
        }
    }
    // oc.putImageData(img, 0, 0)
    const ib = await createImageBitmap(img)
    console.log('ImageBitmap:', ib)
    oc.drawImage(ib, 0, 0, obj.width, obj.height, 0, 0, 800, 480) // 缩放
}

function stop() {
    console.log('stop')
    needStop = true
}
