// СГЕНЕРИРОВАНО manual/tools/sync-core.mjs из ../index.html – не править вручную

/* @ts-self-types="./oilcore.d.ts" */

export class Grid {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        GridFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_grid_free(ptr, 0);
    }
    /**
     * предобуславливатель: true — DILU (неполное разложение, в 3–4 раза меньше итераций), false — Якоби (как в JS)
     * @returns {boolean}
     */
    get dilu() {
        const ret = wasm.__wbg_get_grid_dilu(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @returns {number}
     */
    get last_iters() {
        const ret = wasm.__wbg_get_grid_last_iters(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    get last_resid() {
        const ret = wasm.__wbg_get_grid_last_resid(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get last_rhs0() {
        const ret = wasm.__wbg_get_grid_last_rhs0(this.__wbg_ptr);
        return ret;
    }
    /**
     * Шаг CFL: fac·Vp / max(приток, отток) по ячейкам (q_in — закачка, q_out — отбор скважин), не больше dt_max.
     * @param {Float64Array} ue
     * @param {Float64Array} un
     * @param {Float64Array} q_in
     * @param {Float64Array} q_out
     * @param {number} fac
     * @param {number} dt_max
     * @returns {number}
     */
    cfl(ue, un, q_in, q_out, fac, dt_max) {
        const ptr0 = passArrayF64ToWasm0(ue, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArrayF64ToWasm0(un, wasm.__wbindgen_export2);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArrayF64ToWasm0(q_in, wasm.__wbindgen_export2);
        const len2 = WASM_VECTOR_LEN;
        const ptr3 = passArrayF64ToWasm0(q_out, wasm.__wbindgen_export2);
        const len3 = WASM_VECTOR_LEN;
        const ret = wasm.grid_cfl(this.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, fac, dt_max);
        return ret;
    }
    /**
     * Проводимости восточной (te) и северной (tn) граней: CONV_K·k_гарм·h·½(λt_c + λt_nb)·множитель разлома.
     * @param {Float64Array} sw
     * @param {Float64Array} te
     * @param {Float64Array} tn
     */
    face_t(sw, te, tn) {
        const ptr0 = passArrayF64ToWasm0(sw, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        var ptr1 = passArrayF64ToWasm0(te, wasm.__wbindgen_export2);
        var len1 = WASM_VECTOR_LEN;
        var ptr2 = passArrayF64ToWasm0(tn, wasm.__wbindgen_export2);
        var len2 = WASM_VECTOR_LEN;
        wasm.grid_face_t(this.__wbg_ptr, ptr0, len0, ptr1, len1, addHeapObject(te), ptr2, len2, addHeapObject(tn));
    }
    /**
     * Потоки через грани по давлению: ue[c] > 0 — из c на восток, un[c] > 0 — из c на север.
     * @param {Float64Array} te
     * @param {Float64Array} tn
     * @param {Float64Array} p
     * @param {Float64Array} ue
     * @param {Float64Array} un
     */
    fluxes(te, tn, p, ue, un) {
        const ptr0 = passArrayF64ToWasm0(te, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArrayF64ToWasm0(tn, wasm.__wbindgen_export2);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArrayF64ToWasm0(p, wasm.__wbindgen_export2);
        const len2 = WASM_VECTOR_LEN;
        var ptr3 = passArrayF64ToWasm0(ue, wasm.__wbindgen_export2);
        var len3 = WASM_VECTOR_LEN;
        var ptr4 = passArrayF64ToWasm0(un, wasm.__wbindgen_export2);
        var len4 = WASM_VECTOR_LEN;
        wasm.grid_fluxes(this.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, addHeapObject(ue), ptr4, len4, addHeapObject(un));
    }
    /**
     * tm_e / tm_n — множители проводимости граней (разломы); пустой срез — все 1.
     * @param {number} nx
     * @param {number} ny
     * @param {Uint8Array} active
     * @param {Float64Array} k
     * @param {Float64Array} tm_e
     * @param {Float64Array} tm_n
     * @param {Float64Array} pore
     * @param {number} ct
     * @param {number} h
     * @param {number} swc
     * @param {number} sor
     * @param {number} sw_max
     * @param {number} mu_w
     * @param {number} mu_o
     * @param {number} conv_k
     */
    constructor(nx, ny, active, k, tm_e, tm_n, pore, ct, h, swc, sor, sw_max, mu_w, mu_o, conv_k) {
        const ptr0 = passArray8ToWasm0(active, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArrayF64ToWasm0(k, wasm.__wbindgen_export2);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArrayF64ToWasm0(tm_e, wasm.__wbindgen_export2);
        const len2 = WASM_VECTOR_LEN;
        const ptr3 = passArrayF64ToWasm0(tm_n, wasm.__wbindgen_export2);
        const len3 = WASM_VECTOR_LEN;
        const ptr4 = passArrayF64ToWasm0(pore, wasm.__wbindgen_export2);
        const len4 = WASM_VECTOR_LEN;
        const ret = wasm.grid_new(nx, ny, ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, ptr4, len4, ct, h, swc, sor, sw_max, mu_w, mu_o, conv_k);
        this.__wbg_ptr = ret;
        GridFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * Неявное давление за шаг dt: (acc + ΣT + G)·P − ΣT·P_nb = acc·P_old + G·Pwf, где добавки скважин
     * G и G·Pwf переданы по ячейкам (w_diag, w_rhs). P — на входе P_old (и начальное приближение), на выходе решение.
     * Сходимость: |r| ≤ tol·|b| или maxit итераций (как в JS-ядре). Возвращает число итераций.
     * @param {Float64Array} te
     * @param {Float64Array} tn
     * @param {Float64Array} w_diag
     * @param {Float64Array} w_rhs
     * @param {number} dt
     * @param {Float64Array} p
     * @param {number} tol
     * @param {number} maxit
     * @returns {number}
     */
    solve(te, tn, w_diag, w_rhs, dt, p, tol, maxit) {
        const ptr0 = passArrayF64ToWasm0(te, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArrayF64ToWasm0(tn, wasm.__wbindgen_export2);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArrayF64ToWasm0(w_diag, wasm.__wbindgen_export2);
        const len2 = WASM_VECTOR_LEN;
        const ptr3 = passArrayF64ToWasm0(w_rhs, wasm.__wbindgen_export2);
        const len3 = WASM_VECTOR_LEN;
        var ptr4 = passArrayF64ToWasm0(p, wasm.__wbindgen_export2);
        var len4 = WASM_VECTOR_LEN;
        const ret = wasm.grid_solve(this.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, dt, ptr4, len4, addHeapObject(p), tol, maxit);
        return ret >>> 0;
    }
    /**
     * Явный шаг переноса воды против потока: src — источник воды в ячейке, м³/сут (+закачка, −отбор воды).
     * @param {Float64Array} ue
     * @param {Float64Array} un
     * @param {Float64Array} src
     * @param {number} dt
     * @param {Float64Array} sw
     */
    transport(ue, un, src, dt, sw) {
        const ptr0 = passArrayF64ToWasm0(ue, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArrayF64ToWasm0(un, wasm.__wbindgen_export2);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArrayF64ToWasm0(src, wasm.__wbindgen_export2);
        const len2 = WASM_VECTOR_LEN;
        var ptr3 = passArrayF64ToWasm0(sw, wasm.__wbindgen_export2);
        var len3 = WASM_VECTOR_LEN;
        wasm.grid_transport(this.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2, dt, ptr3, len3, addHeapObject(sw));
    }
    /**
     * предобуславливатель: true — DILU (неполное разложение, в 3–4 раза меньше итераций), false — Якоби (как в JS)
     * @param {boolean} arg0
     */
    set dilu(arg0) {
        wasm.__wbg_set_grid_dilu(this.__wbg_ptr, arg0);
    }
    /**
     * @param {number} arg0
     */
    set last_iters(arg0) {
        wasm.__wbg_set_grid_last_iters(this.__wbg_ptr, arg0);
    }
    /**
     * @param {number} arg0
     */
    set last_resid(arg0) {
        wasm.__wbg_set_grid_last_resid(this.__wbg_ptr, arg0);
    }
    /**
     * @param {number} arg0
     */
    set last_rhs0(arg0) {
        wasm.__wbg_set_grid_last_rhs0(this.__wbg_ptr, arg0);
    }
}
if (Symbol.dispose) Grid.prototype[Symbol.dispose] = Grid.prototype.free;

export function start() {
    wasm.start();
}

/**
 * @returns {string}
 */
export function version() {
    let deferred1_0;
    let deferred1_1;
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        wasm.version(retptr);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        deferred1_0 = r0;
        deferred1_1 = r1;
        return getStringFromWasm0(r0, r1);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
        wasm.__wbindgen_export(deferred1_0, deferred1_1, 1);
    }
}
function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg___wbindgen_copy_to_typed_array_88899a52af046901: function(arg0, arg1, arg2) {
            new Uint8Array(getObject(arg2).buffer, getObject(arg2).byteOffset, getObject(arg2).byteLength).set(getArrayU8FromWasm0(arg0, arg1));
        },
        __wbg___wbindgen_throw_41e9ee4f547fc59a: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbg_error_757e9472f8410341: function(arg0, arg1) {
            let deferred0_0;
            let deferred0_1;
            try {
                deferred0_0 = arg0;
                deferred0_1 = arg1;
                console.error(getStringFromWasm0(arg0, arg1));
            } finally {
                wasm.__wbindgen_export(deferred0_0, deferred0_1, 1);
            }
        },
        __wbg_new_227d7c05414eb861: function() {
            const ret = new Error();
            return addHeapObject(ret);
        },
        __wbg_stack_3b0d974bbf31e44f: function(arg0, arg1) {
            const ret = getObject(arg1).stack;
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_export2, wasm.__wbindgen_export3);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbindgen_object_drop_ref: function(arg0) {
            takeObject(arg0);
        },
    };
    return {
        __proto__: null,
        "./oilcore_bg.js": import0,
    };
}

const GridFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_grid_free(ptr, 1));

function addHeapObject(obj) {
    if (heap_next === heap.length) heap.push(heap.length + 1);
    const idx = heap_next;
    heap_next = heap[idx];

    heap[idx] = obj;
    return idx;
}

function dropObject(idx) {
    if (idx < 1028) return;
    heap[idx] = heap_next;
    heap_next = idx;
}

function getArrayU8FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}

let cachedDataViewMemory0 = null;
function getDataViewMemory0() {
    if (cachedDataViewMemory0 === null || cachedDataViewMemory0.buffer.detached === true || (cachedDataViewMemory0.buffer.detached === undefined && cachedDataViewMemory0.buffer !== wasm.memory.buffer)) {
        cachedDataViewMemory0 = new DataView(wasm.memory.buffer);
    }
    return cachedDataViewMemory0;
}

let cachedFloat64ArrayMemory0 = null;
function getFloat64ArrayMemory0() {
    if (cachedFloat64ArrayMemory0 === null || cachedFloat64ArrayMemory0.byteLength === 0) {
        cachedFloat64ArrayMemory0 = new Float64Array(wasm.memory.buffer);
    }
    return cachedFloat64ArrayMemory0;
}

function getStringFromWasm0(ptr, len) {
    return decodeText(ptr >>> 0, len);
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function getObject(idx) { return heap[idx]; }

let heap = new Array(1024).fill(undefined);
heap.push(undefined, null, true, false);

let heap_next = heap.length;

function passArray8ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 1, 1) >>> 0;
    getUint8ArrayMemory0().set(arg, ptr / 1);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passArrayF64ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 8, 8) >>> 0;
    getFloat64ArrayMemory0().set(arg, ptr / 8);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passStringToWasm0(arg, malloc, realloc) {
    if (realloc === undefined) {
        const buf = cachedTextEncoder.encode(arg);
        const ptr = malloc(buf.length, 1) >>> 0;
        getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
        WASM_VECTOR_LEN = buf.length;
        return ptr;
    }

    let len = arg.length;
    let ptr = malloc(len, 1) >>> 0;

    const mem = getUint8ArrayMemory0();

    let offset = 0;

    for (; offset < len; offset++) {
        const code = arg.charCodeAt(offset);
        if (code > 0x7F) break;
        mem[ptr + offset] = code;
    }
    if (offset !== len) {
        if (offset !== 0) {
            arg = arg.slice(offset);
        }
        ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
        const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
        const ret = cachedTextEncoder.encodeInto(arg, view);

        offset += ret.written;
        ptr = realloc(ptr, len, offset, 1) >>> 0;
    }

    WASM_VECTOR_LEN = offset;
    return ptr;
}

function takeObject(idx) {
    const ret = getObject(idx);
    dropObject(idx);
    return ret;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(ptr, len) {
    numBytesDecoded += len;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
        cachedTextDecoder.decode();
        numBytesDecoded = len;
    }
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

const cachedTextEncoder = new TextEncoder();

if (!('encodeInto' in cachedTextEncoder)) {
    cachedTextEncoder.encodeInto = function (arg, view) {
        const buf = cachedTextEncoder.encode(arg);
        view.set(buf);
        return {
            read: arg.length,
            written: buf.length
        };
    };
}

let WASM_VECTOR_LEN = 0;

let wasmModule, wasmInstance, wasm;
function __wbg_finalize_init(instance, module) {
    wasmInstance = instance;
    wasm = instance.exports;
    wasmModule = module;
    cachedDataViewMemory0 = null;
    cachedFloat64ArrayMemory0 = null;
    cachedUint8ArrayMemory0 = null;
    wasm.__wbindgen_start();
    return wasm;
}

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (!module.ok) {
            throw new Error(`failed to fetch Wasm: ${module.status} ${module.statusText} fetching '${module.url}'`);
        }

        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);
            } catch (e) {
                const validResponse = expectedResponseType(module.type);

                if (validResponse && module.headers.get('Content-Type') !== 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else { throw e; }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);
    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };
        } else {
            return instance;
        }
    }

    function expectedResponseType(type) {
        switch (type) {
            case 'basic': case 'cors': case 'default': return true;
        }
        return false;
    }
}

function initSync(module) {
    if (wasm !== undefined) return wasm;


    if (module !== undefined) {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({module} = module)
        } else {
            console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
        }
    }

    const imports = __wbg_get_imports();
    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }
    const instance = new WebAssembly.Instance(module, imports);
    return __wbg_finalize_init(instance, module);
}

async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;


    if (module_or_path !== undefined) {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }

    if (module_or_path === undefined) {
        module_or_path = new URL('oilcore_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync, __wbg_init as default };

// ---- загрузка: .wasm из base64, асинхронно; ошибки и паники Rust – в консоль, расчёт остаётся на JS ----
const OILCORE_WASM_B64 = "AGFzbQEAAAABsAETYAJ/fwBgA39/fwF/YAJ/fwF/YAF/AGADf39/AGABfwF/YAR/f39/AX9gAABgAX8BfGACf3wAYAABf2ANf39/f39/f39/f39/fwBgCX9/f39/f39/fwBgD39/f39/f39/f3x/f398fwF/YAt/f39/f39/fH9/fwBgC39/f39/f39/f3x8AXxgFH9/f39/f39/f39/f3x8fHx8fHx8AX9gBX9/f39/AGAGf39/f39/AAK7AgYPLi9vaWxjb3JlX2JnLmpzGl9fd2JpbmRnZW5fb2JqZWN0X2Ryb3BfcmVmAAMPLi9vaWxjb3JlX2JnLmpzGl9fd2JnX25ld18yMjdkN2MwNTQxNGViODYxAAoPLi9vaWxjb3JlX2JnLmpzHF9fd2JnX3N0YWNrXzNiMGQ5NzRiYmYzMWU0NGYAAA8uL29pbGNvcmVfYmcuanMcX193YmdfZXJyb3JfNzU3ZTk0NzJmODQxMDM0MQAADy4vb2lsY29yZV9iZy5qcydfX3diZ19fX3diaW5kZ2VuX3Rocm93XzQxZTllZTRmNTQ3ZmM1OWEAAA8uL29pbGNvcmVfYmcuanM1X193YmdfX193YmluZGdlbl9jb3B5X3RvX3R5cGVkX2FycmF5Xzg4ODk5YTUyYWYwNDY5MDEABANPTgUDBgMLAAEGAwACAAwNAA4CDwICEBEAABIEBAAAAQEEBAUABAMCBgMCBwYABQUICAAJCQMDAgAEBAAAAgIAAgEEAQMFAgAHBwAAAAAABwQFAXABHh4FAwEAEQYZA38BQYCAwAALfwBB6KDAAAt/AEHgpMAACwftAxkGbWVtb3J5AgATX193YmdfZ2V0X2dyaWRfZGlsdQAyGV9fd2JnX2dldF9ncmlkX2xhc3RfaXRlcnMAMxlfX3diZ19nZXRfZ3JpZF9sYXN0X3Jlc2lkADQYX193YmdfZ2V0X2dyaWRfbGFzdF9yaHMwADUPX193YmdfZ3JpZF9mcmVlAB0TX193Ymdfc2V0X2dyaWRfZGlsdQAxGV9fd2JnX3NldF9ncmlkX2xhc3RfaXRlcnMANhlfX3diZ19zZXRfZ3JpZF9sYXN0X3Jlc2lkADcYX193Ymdfc2V0X2dyaWRfbGFzdF9yaHMwADgIZ3JpZF9jZmwAFwtncmlkX2ZhY2VfdAASC2dyaWRfZmx1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aiIANgIAQaSkwAAgAEGkpMAAKAIAIgIgACACSxs2AgACQAJAQZykwAAoAgAiAgRAQfChwAAhAANAIAEgACgCACIDIAAoAgQiBmpGDQIgACgCCCIADQALDAILQaykwAAoAgAiAEUNByAAIAFLDQcMCQsgASACTQ0AIAIgA0kNACAAKAIMIgNBAXENACADQQF2IAdGDQMLQaykwABBrKTAACgCACIAIAEgACABSRs2AgAgASAEaiEDQfChwAAhAAJAAkACQANAIAMgACgCACIGRwRAIAAoAggiAA0BDAILCyAAKAIMIgNBAXENACADQQF2IAdGDQELQfChwAAhAANAIAIgACgCACIDTwRAIAIgAyAAKAIEaiIGSQ0DCyAAKAIIIQAMAAsACyAAIAE2AgAgACAAKAIEIARqNgIEIAFBD2pBeHFBCGsiAiAFQQNyNgIEIAZBD2pBeHFBCGsiASACIAVqIgBrIQMgAUGcpMAAKAIARg0EIAFBmKTAACgCAEYNBSABKAIEIgVBA3FBAUYEQCABIAVBeHEiBBARIAEgBGoiASgCBCEFIAMgBGohAwsgASAFQX5xNgIEIAAgA0EBcjYCBCAAIANqIAM2AgAgA0GAAk8EQCAAIAMQFAwICwJAQYikwAAoAgAiAUEBIANBA3Z0IgRxRQRAQYikwAAgASAEcjYCACADQfgBcUGAosAAaiIDIQUMAQsgA0H4AXEiAUGAosAAaiEFIAFBiKLAAGooAgAhAwsgBSAANgIIIAMgADYCDCAAIAU2AgwgACADNgIIDAcLQZykwAAgAUEPakF4cSIAQQhrIgM2AgBBlKTAACAEQShrIgkgASAAa2pBCGoiADYCACADIABBAXI2AgQgASAJakEoNgIEQaikwABBgICAATYCACACIAZBIGtBeHFBCGsiACAAIAJBEGpJGyIDQRs2AgRB8KHAACkCACEKIANBEGpB+KHAACkCADcCACADQQhqIgAgCjcCAEH8ocAAIAc2AgBB9KHAACAENgIAQfChwAAgATYCAEH4ocAAIAA2AgAgA0EcaiEAA0AgAEEHNgIAIABBBGoiACAGSQ0ACyACIANGDQggAyADKAIEQX5xNgIEIAIgAyACayIAQQFyNgIEIAMgADYCACAAQYACTwRAIAIgABAUDAkLAkBBiKTAACgCACIBQQEgAEEDdnQiBHFF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QQgQOyIgRQ0BIAJFDQAgICAhIAL8CgAACwJAAkAgACADRwRAIABBA3QhAkEAIRUgAEH/////AUsNBSACQfj///8HSw0FAkAgAkUEQEEIIQZBACEBDAELQQghFSAAIQEgAkEIEDsiBkUNBgsgAEECTwRAIABBAWsiA0EHcSEVIAYhAiAAQQJrQQdPBEAgA0F4cSEKA0AgAkKAgICAgICA+D83AwAgAkE4akKAgICAgICA+D83AwAgAkEwakKAgICAgICA+D83AwAgAkEoakKAgICAgICA+D83AwAgAkEgakKAgICAgICA+D83AwAgAkEYakKAgICAgICA+D83AwAgAkEQakKAgICAgICA+D83AwAgAkEIakKAgICAgICA+D83AwAgAkFAayECIApBCGsiCg0ACyAVRQ0DCwNAIAJCgICAgICAgPg/NwMAIAJBCGohAiAVQQFrIhUNAAsMAgsgBiECIAANAUEAIQMMAgsgA0UEQEEIIQZBACEDQQAhAQwCCyADQQN0IgJBCBA7IgZFDQIgAkUEQCADIQEMAgsgBiAiIAL8CgAAIAMhAQwBCyACQoCAgICAgID4PzcDACAAIQMLAkACQCAAIARHBEAgAEEDdCECQQAhFSAAQf////8BSw0FIAJB+P///wdLDQUCQCACRQRAQQghCEEAIQUMAQtBCCEVIAAhBSACQQgQOyIIRQ0GCyAAQQJPBEAgAEEBayIEQQdxIRUgCCECIABBAmtBB08EQCAEQXhxIQoDQCACQoCAgICAgID4PzcDACACQThqQoCAgICAgID4PzcDACACQTBqQoCAgICAgID4PzcDACACQShqQoCAgICAgID4PzcDACACQSBqQoCAgICAgID4PzcDACACQRhqQoCAgICAgID4PzcDACACQRBqQoCAgICAgID4PzcDACACQQhqQoCAgICAgID4PzcDACACQUBrIQIgCkEIayIKDQALIBVFDQMLA0AgAkKAgICAgICA+D83AwAgAkEIaiECIBVBAWsiFQ0ACwwCCyAIIQIgAA0BQQAhBAwCCyAERQRAQQghCEEAIQRBACEFDAILIARBA3QiAkEIEDsiCEUNAiACRQRAIAQhBQwCCyAIICMgAvwKAAAgBCEFDAELIAJCgICAgICAgPg/NwMAIAAhBAsCQCAbRQRAQQghCgwBCyAbQQN0IgJBCBA7IgoEQCACRQ0BIAogJCAC/AoAAAwBCwwBCyAWQQN0IQJBACEVAkACQAJAAkAgFkH/////AEsNBgJAIBZFBEBBCCEmQQghJ0EIIShBCCEpQQghKkEIIStBCCEsDAELQQghFSACECciKUUNByACECciKEUNBSACECciKkUNBSACECciJ0UNBSACECciK0UNBSACECciJkUNBSACECciLEUNBQsgAEEDdCEZQQAhFSAAQf////8BSw0AIBlB+P///wdLDQBBCCEtAkAgGUUEQEEIIS5BCCEvQQghMAwBC0EIIRUgGRAnIi9FDQEgGRAnIi5FDQIgACEVIBkQJyIwRQ0DCyAWBEAgAhAnIi1FDQQLIBQgGzYCoAEgFCAKNgKcASAUIBs2ApgBIBQgBDYClAEgFCAINgKQASAUIAU2AowBIBQgAzYCiAEgFCAGNgKEASAUIAE2AoABIBQgGjYCfCAUICA2AnggFCAaNgJ0IBQgFjYCcCAUIB82AmwgFCAzNgJoIBQgFzYCZCAUIBw2AmAgFCAXNgJcIBQgMjYCVCAUIDE2AlAgFEEBOgC0AiAUIBY2ArACIBQgLTYCrAIgFCAWNgKoAiAUIAA2AqQCIBQgMDYCoAIgFCAVNgKcAiAUIAA2ApgCIBQgLjYClAIgFCAVNgKQAiAUIAA2AowCIBQgLzYCiAIgFCAVNgKEAiAUIAA2AoACIBQgCzYC/AEgFCAlNgL4ASAUIBY2AvQBIBQgLDYC8AEgFCAWNgLsASAUIBY2AugBIBQgJjYC5AEgFCAWNgLgASAUIBY2AtwBIBQgKzYC2AEgFCAWNgLUASAUIBY2AtABIBQgJzYCzAEgFCAWNgLIASAUIBY2AsQBIBQgKjYCwAEgFCAWNgK8ASAUIBY2ArgBIBQgKDYCtAEgFCAWNgKwASAUIBY2AqwBIBQgKTYCqAEgFCAWNgKkASAUIBM5AzggFCASOQMwIBQgETkDKCAUIBA5AyAgFCAPOQMYIBQgDjkDECAUIA05AwggFCAMOQMAIBRCADcDQCAUQQA2AlggFEIANwNIIBhBEGokAAwFCyAVIBkQPAALQQggGRA8AAtBCCAZEDwACwtBCCACEDwACyAbBEAgJCAbQQN0ECILIAkEQCAjIAlBA3QQIgsgBwRAICIgB0EDdBAiCyAaBEAgISAaQQN0ECILIBcEQCAeIBcQIgsgHUHIAmogHUEIakG4AvwKAABByAJBCBA7IgBFBEBBCEHIAhBPAAsgAEEANgIIIABCgYCAgBA3AwAgAEEMaiAdQcQCakG8AvwKAAAgHUGABWokACAAQQhqDwsgFSACEDwAC4kDAQN/IwBBIGsiBSQAQfykwABB/KTAACgCACIGQQFqNgIAAkACQAJAAkACQAJAAkACQAJ/QQAgBkEASA0AGkEBQeikwAAtAAANABpB6KTAAEEBOgAAQeSkwABB5KTAACgCAEEBajYCAEECC0H/AXEOAwQBAAELQfCkwAAoAgAiBkEASA0DIAYgBkEBaiIHSg0EQfCkwAAgBzYCAEH0pMAAKAIADQFB8KTAACAHQQFrNgIADAILIAUgACABKAIYEQAAAAsgBUEIaiAAIAEoAhQRAAAgBSAEOgAdIAUgAzoAHCAFIAI2AhggBSAFKQMINwIQQfSkwAAoAgAgBUEQakH4pMAAKAIAKAIUEQAAQfCkwABB8KTAACgCACIAQQFrNgIAIABBAEwNAwtB6KTAAEEAOgAAIAMNAwsACyMAQRBrIgAkACAAQRw2AgQgAEGknMAANgIAIAAgAK1CgICAgMADhDcDCEGlgcAAIABBCGpBwJzAABApAAtBxJ3AAEHNAEHsncAAECkACwAL4gECAn8BfiMAQSBrIgIkACABKAIAQX9GBEAgASgCDCEDIAJBADYCGCACQoCAgIAQNwIQIAJBEGpBpJrAACADKAIAIgMoAgAgAygCBBANGiACIAIoAhgiAzYCCCACIAIpAhAiBDcDACABIAM2AgggASAENwIACyABKAIIIQMgAUEANgIIIAEpAgAhBCABQoCAgIAQNwIAIAIgAzYCGCACIAQ3AxBBDEEEEDsiAUUEQEEEQQwQTwALIAEgAigCGDYCCCABIAIpAxA3AgAgAEG0ncAANgIEIAAgATYCACACQSBqJAALugEBAn8jAEHQAmsiAiQAAkACQAJAIAFFBEAgAEUNASAAQQhrIgEoAgBBAUcNAiACQRhqIAJBEGogAEHAAvwKAAAgAUEANgIAAkAgAUF/Rg0AIABBBGsiACAAKAIAQQFrIgA2AgAgAA0AIAFByAIQIgsQDgwDCyAARQ0AIABBCGsiACAAKAIAQQFrIgE2AgAgAiAANgIMIAENAiACQQxqEC0MAgsQTAALQfiXwABBPxBLAAsgAkHQAmokAAudAQICfwF+QQEhB0EEIQYCQCAFrSADrX4iCEIgiEIAUgRAQQAhAwwBCyAIpyIDQYCAgIB4IARrSwRAQQAhAwwBCwJAAkACfyABBEAgAiABIAVsIAQgAxAIDAELIANFBEAgBCEGDAILIAMgBBA7CyIGDQAgACAENgIEDAELIAAgBjYCBEEAIQcLQQghBgsgACAGaiADNgIAIAAgBzYCAAuHAQEBfyMAQRBrIgMkACACIAEgAmoiAUsEQEEAQQAQPAALIANBBGogACgCACICIAAoAgRBCCABIAJBAXQiAiABIAJLGyIBIAFBCE0bIgFBAUEBEB4gAygCBEEBRgRAIAMoAgggAygCDBA8AAsgAygCCCECIAAgATYCACAAIAI2AgQgA0EQaiQAC+wBAQR/IwBBEGsiAyQAIAIgASACaiIESwRAQQBBABA8AAsgA0EEaiEBIAAoAgAiAiEFIAAoAgQhBgJAQQggBCACQQF0IgIgAiAESRsiAiACQQhNGyICQQBOBEACfyAFBEAgBiAFQQEgAhAIDAELIAJBARA7CyIERQRAIAEgAjYCCCABQQE2AgQgAUEBNgIADAILIAEgAjYCCCABIAQ2AgQgAUEANgIADAELIAFBADYCBCABQQE2AgALIAMoAgRBAUYEQCADKAIIIAMoAgwQPAALIAMoAgghASAAIAI2AgAgACABNgIEIANBEGokAAuNAQICfwF+IwBBIGsiAiQAIAEoAgBBf0YEQCABKAIMIQMgAkEANgIcIAJCgICAgBA3AhQgAkEUakGkmsAAIAMoAgAiAygCACADKAIEEA0aIAIgAigCHCIDNgIQIAIgAikCFCIENwMIIAEgAzYCCCABIAQ3AgALIABBtJ3AADYCBCAAIAE2AgAgAkEgaiQAC1sBAn8CQCAAQQRrKAIAIgJBeHEiA0EEQQggAkEDcSICGyABak8EQCACQQAgAyABQSdqSxsNASAAEAkPC0GUm8AAQS5BxJvAABA9AAtB1JvAAEEuQYScwAAQPQALVAEBfwJAAkAgACgCACAAKAIIIgNrIAJJBEAgACADIAIQHyAAKAIIIQMMAQsgAkUNAQsgAkUNACAAKAIEIANqIAEgAvwKAAALIAAgAiADajYCCEEAC1QBAX8CQAJAIAAoAgAgACgCCCIDayACSQRAIAAgAyACECAgACgCCCEDDAELIAJFDQELIAJFDQAgACgCBCADaiABIAL8CgAACyAAIAIgA2o2AghBAAtQAQF/IwBBIGsiAyQAIAMgATYCDCADIAA2AgggAyADQQhqrUKAgICAsAGENwMYIAMgA0EMaq1CgICAgLABhDcDEEHqgMAAIANBEGogAhApAAtQAQF/IwBBIGsiAyQAIAMgATYCCCADIAA2AgwgAyADQQxqrUKAgICAsAGENwMYIAMgA0EIaq1CgICAgLABhDcDEEHVhcAAIANBEGogAhApAAsuAQF/AkAgABAGIgFFDQAgAUEEay0AAEEDcUUNACAARQ0AIAFBACAA/AsACyABC0QBAn8gASgCBCECIAEoAgAhA0EIQQQQOyIBRQRAQQRBCBBPAAsgASACNgIEIAEgAzYCACAAQZSdwAA2AgQgACABNgIAC9oBAgF/AX4jAEEgayIDJAAgAyABNgIQIAMgADYCDCADQQE7ARwgAyACNgIYIAMgA0EMajYCFCMAQRBrIgEkACADQRRqIgApAgAhBCABIAA2AgwgASAENwIEIwBBEGsiACQAIAFBBGoiASgCACICKAIEIgNBAXEEQCACKAIAIQIgACADQQF2NgIEIAAgAjYCACAAQbyawAAgASgCBCABKAIIIgAtAAggAC0ACRAbAAsgAEF/NgIAIAAgATYCDCAAQdiawAAgASgCBCABKAIIIgAtAAggAC0ACRAbAAs/AQF/QQ1BARA7IgFFBEBBAUENEDwACyAAQQ02AgQgACABNgIAIAFB/YbAACkAADcABSABQfiGwAApAAA3AAALRgAgACgCAEF/RwRAIAEoAgAgACgCBCAAKAIIIAEoAgQoAgwRAQAPCyABKAIAIAEoAgQgACgCDCgCACIAKAIAIAAoAgQQDQs1AAJAIAJBf0YNACAAIAIgASgCEBECAEUNAEEBDwsgA0UEQEEADwsgACADQQAgASgCDBEBAAs0AQF/IAAoAgAiAEEQahAOAkAgAEF/Rg0AIAAgACgCBEEBayIBNgIEIAENACAAQcgCECILCzAAAkACQCABaUEBRw0AIABBgICAgHggAWtLDQAgAEUNASAAIAEQOyIBDQELAAsgAQu/AgEEfyMAQRBrIgIkAEG8pMAALQAAQQNHBEAgAkEBOgAPIAJBD2ohAAJAAkACQAJAAkBBvKTAAC0AAEEBaw4DAQMEAAtBvKTAAEECOgAAIAAtAAAgAEEAOgAARQ0BAkACQAJAQfykwAAoAgBB/////wdxBEBB5KTAACgCAA0BC0HwpMAAKAIADQFB+KTAACgCACEAQfikwABBwIbAADYCAEH0pMAAKAIAIQFB9KTAAEEBNgIAAkAgAUUNACAAKAIAIgMEQCABIAMRAwALIAAoAgQiA0UNACAAKAIIGiABIAMQIgsMAgtB0JzAAEHpAEGEncAAECkLAAtBvKTAAEEDOgAADAMLQYCAwABB1QBB6IbAABApAAtBoJ7AAEErQbCGwAAQPQALQaqAwABB8QBB6IbAABApAAsLIAJBEGokAAsvAAJAAkAgA2lBAUcNACABQYCAgIB4IANrSw0AIAAgASADIAIQCCIADQELAAsgAAsjAAJAIAAEQCAAKAIADQEgACABQQBHOgC8Ag8LEEwACxBNAAslAAJAIAAEQCAAKAIAQf////8HTw0BIAAtALwCDwsQTAALEE0ACyQAAkAgAARAIAAoAgBB/////wdPDQEgACgCYA8LEEwACxBNAAskAAJAIAAEQCAAKAIAQf////8HTw0BIAArA0gPCxBMAAsQTQALJAACQCAABEAgACgCAEH/////B08NASAAKwNQDwsQTAALEE0ACx8AAkAgAARAIAAoAgANASAAIAE2AmAPCxBMAAsQTQALHwACQCAABEAgACgCAA0BIAAgATkDSA8LEEwACxBNAAsfAAJAIAAEQCAAKAIADQEgACABOQNQDwsQTAALEE0ACxoBAX8gACgCACIBQQBKBEAgACgCBCABECILCxcBAX8gACgCACIBBEAgACgCBCABECILCxUAIAFBCU8EQCABIAAQEA8LIAAQBgsdACAABEAgACABEE8AC0H8ncAAQSNBkJ7AABApAAsRACAAIAFBAXRBAXIgAhApAAsNACABBEAgACABECILCxwAIABBjJvAACkCADcCCCAAQYSbwAApAgA3AgALHAAgAEH8msAAKQIANwIIIABB9JrAACkCADcCAAsUACAAKAIAIAEgACgCBCgCDBECAAsQACABIAAoAgAgACgCBBAMCxMAIABBlJ3AADYCBCAAIAE2AgALHAAgASgCACAAKAIAIAAoAgQgASgCBCgCDBEBAAsPACAAQcSYwAAgASACEA0LDQAgACABIAIoAgAQBQsPACAAQaSawAAgASACEA0LDwBBrKDAAEHzACAAECkACwsAIAAjAGokACMACxkAIAEoAgBBtJnAAEEFIAEoAgQoAgwRAQALCQAgACABEAQACwwAQbmZwABBGxBLAAsNAEHUmcAAQc8AEEsACwwAIAAgASkCADcDAAs9AQF/IwBBEGsiAiQAIAIgATYCDCACIAA2AgggAkEIaiIAKAIAIAAoAgRB7KTAACgCACIAQQogABsRAAAACwwAQYClwABBAToAAAsJACAAQQA2AgAL5wYCBn8BfgJAIwBBMGsiAiQAIAJBADYCGCACQoCAgIAQNwIQIAJBxJjAADYCICACQqCAgIAGNwIkIAIgAkEQajYCHCMAQTBrIgMkAEEBIQYCQCACQRxqIgUiACgCAEGkncAAQQwgACgCBCgCDBEBAA0AIAUoAgQhBCAFKAIAIAMgASgCCCIAKQIANwIIIAMgAEEMaq1CgICAgLABhDcDICADIABBCGqtQoCAgICwAYQ3AxggAyADQQhqrUKAgICAwAGENwMQIARB4oDAACADQRBqIgcQDQ0AIAcgASgCACIEIAEoAgQoAgwiAREAACAEIQACQCADKQMQQtzsp//F24D7uX+FIAMpAxhC8YPD46a+2OAkhYRCAFIEfyAHIAAgAREAACADKQMQQrvutNKkkMSiCYUgAykDGELDy4aL/YeInY9/hYRCAFINASAAQQRqIQBBCAVBBAsgBGooAgAhASAAKAIAIQAgBSgCAEGwncAAQQIgBSgCBCgCDBEBAA0BIAUoAgAgACABIAUoAgQoAgwRAQANAQtBACEGCyADQTBqJAACQCAGRQRAIAIgAigCGCIANgIIIAIgAikCECIINwMAIAinIgMgAGtBCU0EQCACIABBChAgIAIoAgAhAyACKAIIIQALIAIoAgQiASAAaiIEQbeYwAApAAA3AAAgBEG/mMAALwAAOwAIIAIgAEEKaiIANgIIIAJBHGoQASIFEAIgAigCHCEGAkACQCACKAIgIgQgAyAAa0sEQCACIAAgBBAgIAIoAgAhAyACKAIEIQEgAigCCCEADAELIARFDQELIARFDQAgACABaiAGIAT8CgAACyACIAAgBGoiADYCCCADIABrQQFNBEAgAiAAQQIQICACKAIEIQEgAigCCCEACyAAIAFqQYoUOwAAIAIgAEECaiIANgIIIAAgAigCACIDSQRAIAEgA0EBIAAQCCIBRQ0CCyABIAAQAyAEBEAgBiAEECILIAVBhAhPBEAgBRAACyACQTBqJAAMAgsjAEEgayIAJAAgAEE3NgIEIABB7JjAADYCACAAQdyYwAA2AgwgACACQS9qNgIIIAAgAEEIaq1CgICAgNADhDcDGCAAIACtQoCAgIDAA4Q3AxBBoYHAACAAQRBqQaSZwAAQKQALQQEgABA8AAsLAgALC4QhBQBBgIDAAAu9Bk9uY2UgaW5zdGFuY2UgaGFzIHByZXZpb3VzbHkgYmVlbiBwb2lzb25lZG9uZS10aW1lIGluaXRpYWxpemF0aW9uIG1heSBub3QgYmUgcGVyZm9ybWVkIHJlY3Vyc2l2ZWx5wAE6wAE6wAAgaW5kZXggb3V0IG9mIGJvdW5kczogdGhlIGxlbiBpcyDAEiBidXQgdGhlIGluZGV4IGlzIMAAwAI6IMAAL3J1c3RjLzU4Y2Y4ZjljMzViMzU1MTk5NzI3NjI3ZDA3YWUzNGE0ZTI4NDZkNjcvbGlicmFyeS9zdGQvc3JjL3N5cy9zeW5jL3J3bG9jay9ub190aHJlYWRzLnJzAC9ydXN0Yy81OGNmOGY5YzM1YjM1NTE5OTcyNzYyN2QwN2FlMzRhNGUyODQ2ZDY3L2xpYnJhcnkvYWxsb2Mvc3JjL3N0cmluZy5ycwAvcnVzdGMvNThjZjhmOWMzNWIzNTUxOTk3Mjc2MjdkMDdhZTM0YTRlMjg0NmQ2Ny9saWJyYXJ5L3N0ZC9zcmMvcGFuaWNraW5nLnJzAC9ydXN0Yy81OGNmOGY5YzM1YjM1NTE5OTcyNzYyN2QwN2FlMzRhNGUyODQ2ZDY3L2xpYnJhcnkvc3RkL3NyYy9zeW5jL29uY2UucnMAL3J1c3RjLzU4Y2Y4ZjljMzViMzU1MTk5NzI3NjI3ZDA3YWUzNGE0ZTI4NDZkNjcvbGlicmFyeS9hbGxvYy9zcmMvcmF3X3ZlYy9tb2QucnMAL3J1c3QvZGVwcy9kbG1hbGxvYy0wLjIuMTQvc3JjL2RsbWFsbG9jLnJzAEM6XFVzZXJzXGRpbWF2XC5jYXJnb1xyZWdpc3RyeVxzcmNcaW5kZXguY3JhdGVzLmlvLTE5NDljZjhjNmI1YjU1N2ZcY29uc29sZV9lcnJvcl9wYW5pY19ob29r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ABQAAAAVAAAAEAAAAAQAAAAWAAAAFwAAABgAAAAZAAAAXPbpX9wC9rnxwXBs8mHBJDs3TUqCEEUJw6Vh0T8gOo9hc3NlcnRpb24gZmFpbGVkOiBwc2l6ZSA+PSBzaXplICsgbWluX292ZXJoZWFkAAA8AhAAKgAAAOkEAAAJAAAAYXNzZXJ0aW9uIGZhaWxlZDogcHNpemUgPD0gc2l6ZSArIG1heF9vdmVyaGVhZAAAPAIQACoAAADvBAAADQAAADwCEAAqAAAATQUAAB4AAAByd2xvY2sgb3ZlcmZsb3dlZCByZWFkIGxvY2tzpwAQAF0AAAAYAAAALAAAAGNhbm5vdCBtb2RpZnkgdGhlIHBhbmljIGhvb2sgZnJvbSBhIHBhbmlja2luZyB0aHJlYWRRARAATAAAAJAAAAAJAAAAAAAAAAgAAAAEAAAAGgAAAHBhbmlja2VkIGF0IDoKAAANAAAADAAAAAQAAAAbAAAAcndsb2NrIGhhcyBub3QgYmVlbiBsb2NrZWQgZm9yIHJlYWRpbmcAAKcAEABdAAAAQQAAAAkAAABjYXBhY2l0eSBvdmVyZmxvdwAAAOsBEABQAAAAHAAAAAUAAABjYWxsZWQgYE9wdGlvbjo6dW53cmFwKClgIG9uIGEgYE5vbmVgIHZhbHVlMDAwMTAyMDMwNDA1MDYwNzA4MDkxMDExMTIxMzE0MTUxNjE3MTgxOTIwMjEyMjIzMjQyNTI2MjcyODI5MzAzMTMyMzMzNDM1MzYzNzM4Mzk0MDQxNDI0MzQ0NDU0NjQ3NDg0OTUwNTE1MjUzNTQ1NTU2NTc1ODU5NjA2MTYyNjM2NDY1NjY2NzY4Njk3MDcxNzI3Mzc0NzU3Njc3Nzg3OTgwODE4MjgzODQ4NTg2ODc4ODg5OTA5MTkyOTM5NDk1OTY5Nzk4OTlhdHRlbXB0IHRvIGRpdmlkZSBieSB6ZXJvYXR0ZW1wdCB0byBjYWxjdWxhdGUgdGhlIHJlbWFpbmRlciB3aXRoIGEgZGl2aXNvciBvZiB6ZXJvAEHooMAACwUJAAAABABBtqTAAAsEAQD/DwBICXByb2R1Y2VycwEMcHJvY2Vzc2VkLWJ5AgZ3YWxydXMGMC4yNy4yDHdhc20tYmluZGdlbhMwLjIuMTI5ICgxNjU1ODZmODUp";
(async () => {
  try {
    const bytes = Uint8Array.from(atob(OILCORE_WASM_B64), (c) => c.charCodeAt(0));
    await __wbg_init({ module_or_path: bytes });
    globalThis.__oilAccel = { Grid, version };
    if (globalThis.__accelReady) globalThis.__accelReady(); else globalThis.OILCORE.setAccel(globalThis.__oilAccel); // игра решает, включать ли ускорение (настройка расчёта)
    globalThis.OILWASM = version();
    console.info("Ускоритель WebAssembly подключён:", version());
  } catch (e) {
    console.warn("WebAssembly недоступен – расчёт на JS-ядре", e);
  }
})();
