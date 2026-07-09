/**
 * JSON 转 TypeScript 接口生成器
 * 纯原生 TypeScript 零依赖实现。
 *
 * 核心能力：
 *  - 递归类型推断：从 JSON 值推断 TS 类型（string/number/boolean/null/array/object）
 *  - 联合类型合并：数组元素类型不同、同名字段类型不同时合并为联合类型
 *  - 可选字段检测：数组中对象的字段不一致时，缺失字段标记为可选（?:）
 *  - 嵌套类型提取：复杂对象提取为独立 interface，相同结构复用同名（去重）
 *  - 命名导出：生成 export interface 声明 + 根类型别名
 *
 * 设计取舍：
 *  - 采用「TypeInfo 树 + 结构签名去重」策略，而非完整 AST
 *  - interface 去重基于字段签名（键名 + 值类型签名排序拼接），相同结构只生成一份
 *  - 数组元素类型合并：递归 mergeTypeInfo，支持 number|string 联合、对象字段并集
 *  - 不做 JSON Schema 生成，仅做类型推断
 */

/** 类型种类标签 */
type TypeKind =
  | 'string'
  | 'number'
  | 'boolean'
  | 'null'
  | 'array'
  | 'object'
  | 'any';

/** 字段信息：键名 + 值类型 + 是否可选 */
interface FieldInfo {
  key: string;
  type: TypeInfo;
  optional: boolean;
}

/** 类型信息树节点 */
interface TypeInfo {
  kind: TypeKind;
  /** object：字段列表 */
  fields?: FieldInfo[];
  /** array：元素类型 */
  elem?: TypeInfo;
  /** 联合类型：当合并冲突且无法归一时，存放多个候选 */
  union?: TypeInfo[];
  /** object 结构签名（用于去重） */
  signature?: string;
  /** 去重后分配的接口名（object 专有） */
  interfaceName?: string;
}

/** 生成选项 */
export interface JsonToTsOptions {
  /** 根接口名，默认 'Root' */
  rootName?: string;
  /** 是否使用 export 关键字，默认 true */
  exportKeyword?: boolean;
  /** 是否将数组对象中缺失字段标记为可选，默认 true */
  optionalFields?: boolean;
  /** 数组类型风格，默认 'bracket'（T[]） */
  arrayStyle?: 'bracket' | 'generic';
  /** 是否将 null 合并到其他类型（string|null → string | null 仍保留），默认 true 保留 null */
  keepNull?: boolean;
}

/** 解析结果 */
export interface JsonToTsResult {
  ok: boolean;
  /** 生成的 TS 代码（失败时为空） */
  code: string;
  /** 错误信息（成功时为 null） */
  error: string | null;
  /** 统计信息 */
  stats: {
    interfaceCount: number;
    fieldCount: number;
    charCount: number;
    lineCount: number;
  };
}

// ============ 基础工具 ============

/** 判断是否为普通对象（非数组、非 null） */
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** 合并两个类型信息，返回新的 TypeInfo（不修改入参） */
function mergeTypeInfo(a: TypeInfo, b: TypeInfo, opts: Required<JsonToTsOptions>): TypeInfo {
  // 同类型归一
  if (a.kind === b.kind) {
    if (a.kind === 'object') {
      // 对象：合并字段（同名字段递归合并类型，缺失字段标记可选）
      return mergeObjectTypes([a, b], opts);
    }
    if (a.kind === 'array') {
      // 数组：合并元素类型
      const aElem = a.elem ?? { kind: 'any' };
      const bElem = b.elem ?? { kind: 'any' };
      return { kind: 'array', elem: mergeTypeInfo(aElem, bElem, opts) };
    }
    // 基本类型同类直接返回
    return a;
  }

  // null 与其他类型合并：保留 null 为联合（如 string | null）
  if (a.kind === 'null') return toUnion(b, a, opts);
  if (b.kind === 'null') return toUnion(a, b, opts);
  if (!opts.keepNull) {
    // 不保留 null 时，丢弃 null 候选
    if (a.kind === 'any') return b;
    if (b.kind === 'any') return a;
  }

  // 不同基本类型 → 联合类型
  return toUnion(a, b, opts);
}

/** 构造联合类型（去重 + 排序保证稳定输出） */
function toUnion(a: TypeInfo, b: TypeInfo, _opts: Required<JsonToTsOptions>): TypeInfo {
  const candidates = collectUnion([a, b]);
  if (candidates.length === 1) return candidates[0];
  // 按类型签名去重
  const seen = new Set<string>();
  const unique: TypeInfo[] = [];
  for (const c of candidates) {
    const sig = signatureOf(c);
    if (!seen.has(sig)) {
      seen.add(sig);
      unique.push(c);
    }
  }
  // 单一类型直接返回
  if (unique.length === 1) return unique[0];
  // 按签名排序，保证输出稳定
  unique.sort((x, y) => signatureOf(x).localeCompare(signatureOf(y)));
  return { kind: 'any', union: unique };
}

/** 展开联合候选（递归收集所有 union 成员） */
function collectUnion(list: TypeInfo[]): TypeInfo[] {
  const out: TypeInfo[] = [];
  for (const t of list) {
    if (t.kind === 'any' && t.union) {
      out.push(...collectUnion(t.union));
    } else {
      out.push(t);
    }
  }
  return out;
}

/** 合并多个对象类型为统一对象类型（字段并集，缺失字段可选） */
function mergeObjectTypes(objs: TypeInfo[], opts: Required<JsonToTsOptions>): TypeInfo {
  const fieldMap = new Map<string, TypeInfo[]>();
  for (const obj of objs) {
    if (!obj.fields) continue;
    for (const f of obj.fields) {
      if (!fieldMap.has(f.key)) fieldMap.set(f.key, []);
      fieldMap.get(f.key)!.push(f.type);
    }
  }
  const fields: FieldInfo[] = [];
  for (const [key, types] of fieldMap) {
    // 合并同名字段类型
    let merged = types[0];
    for (let i = 1; i < types.length; i++) {
      merged = mergeTypeInfo(merged, types[i], opts);
    }
    // 字段在所有对象中都存在 → 必选；任一对象缺失 → 可选
    const optional = opts.optionalFields && types.length < objs.length;
    fields.push({ key, type: merged, optional });
  }
  // 字段按名称排序，保证输出稳定
  fields.sort((a, b) => a.key.localeCompare(b.key));
  return { kind: 'object', fields };
}

// ============ 类型签名（用于 interface 去重） ============

/** 计算类型的结构签名（用于去重比较） */
function signatureOf(t: TypeInfo): string {
  if (t.kind === 'object' && t.fields) {
    // 对象签名：键名:值签名 按字典序拼接，用 | 分隔
    const parts = t.fields.map((f) => `${f.key}${f.optional ? '?' : ''}:${signatureOf(f.type)}`);
    return `{${parts.join('|')}}`;
  }
  if (t.kind === 'array' && t.elem) {
    return `[${signatureOf(t.elem)}]`;
  }
  if (t.kind === 'any' && t.union) {
    const parts = t.union.map(signatureOf).sort();
    return parts.join('|');
  }
  return t.kind;
}

// ============ 类型推断 ============

/** 从 JS 值推断 TypeInfo */
function inferType(value: unknown, opts: Required<JsonToTsOptions>): TypeInfo {
  if (value === null) return { kind: 'null' };
  if (typeof value === 'string') return { kind: 'string' };
  if (typeof value === 'number') return { kind: 'number' };
  if (typeof value === 'boolean') return { kind: 'boolean' };
  if (Array.isArray(value)) {
    if (value.length === 0) return { kind: 'array', elem: { kind: 'any' } };
    // 合并所有元素类型
    let elem = inferType(value[0], opts);
    for (let i = 1; i < value.length; i++) {
      elem = mergeTypeInfo(elem, inferType(value[i], opts), opts);
    }
    return { kind: 'array', elem };
  }
  if (isPlainObject(value)) {
    const fields: FieldInfo[] = Object.entries(value).map(([k, v]) => ({
      key: k,
      type: inferType(v, opts),
      optional: false,
    }));
    return { kind: 'object', fields };
  }
  return { kind: 'any' };
}

// ============ interface 提取与命名 ============

interface ExtractResult {
  /** 按声明顺序排列的接口列表（含接口名 + 对应 TypeInfo） */
  interfaces: { name: string; type: TypeInfo }[];
  /** 处理后的根类型（对象引用接口名，数组/联合递归处理） */
  rootType: TypeInfo;
}

/** 提取所有对象类型为独立 interface，相同结构复用同名 */
function extractInterfaces(root: TypeInfo, rootName: string): ExtractResult {
  // 签名 → 接口名 映射（去重）
  const sigToName = new Map<string, string>();
  // 接口声明列表（按首次出现顺序）
  const interfaces: { name: string; type: TypeInfo }[] = [];

  /** 为对象类型分配接口名（去重） */
  function nameObject(t: TypeInfo, suggestedName: string): string {
    if (!t.fields) return suggestedName;
    const sig = signatureOf(t);
    // 已存在则复用
    const existing = sigToName.get(sig);
    if (existing) return existing;
    // 新建：使用建议名
    sigToName.set(sig, suggestedName);
    interfaces.push({ name: suggestedName, type: t });
    return suggestedName;
  }

  /** 递归处理类型树，返回带接口名引用的新 TypeInfo */
  function walk(t: TypeInfo, name: string): TypeInfo {
    if (t.kind === 'object' && t.fields) {
      // 为当前对象分配名，并递归处理字段
      const ifaceName = nameObject(t, name);
      // 递归处理每个字段：字段名首字母大写作为子类型建议名
      const newFields: FieldInfo[] = t.fields.map((f) => {
        const childName = `${name}${capitalize(f.key)}`;
        return { ...f, type: walk(f.type, childName) };
      });
      return { kind: 'object', fields: newFields, signature: signatureOf(t), interfaceName: ifaceName };
    }
    if (t.kind === 'array' && t.elem) {
      // 数组元素用 <Name>Item 命名
      const elem = walk(t.elem, `${name}Item`);
      return { kind: 'array', elem };
    }
    if (t.kind === 'any' && t.union) {
      // 联合类型递归处理每个候选
      const union = t.union.map((u, i) => walk(u, `${name}Option${i + 1}`));
      return { kind: 'any', union };
    }
    return t;
  }

  // 根类型处理：根是对象则命名为 Root（interface 本身即类型，无需额外 type 别名）
  const rootType = walk(root, rootName);
  return { interfaces, rootType };
}

/** 首字母大写 */
function capitalize(s: string): string {
  if (!s) return s;
  // 仅处理 ASCII 字母，中文等保持原样
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ============ 序列化 ============

/** 将 TypeInfo 序列化为 TS 类型表达式字符串 */
function serializeType(t: TypeInfo, opts: Required<JsonToTsOptions>, indent = 0): string {
  switch (t.kind) {
    case 'string':
    case 'number':
    case 'boolean':
    case 'null':
      return t.kind;
    case 'any':
      if (t.union) {
        return t.union.map((u) => serializeType(u, opts, indent)).join(' | ');
      }
      return 'any';
    case 'array': {
      const elemStr = t.elem ? serializeType(t.elem, opts, indent) : 'any';
      // 元素为联合类型时需加括号：(string | number)[]
      if (t.elem && t.elem.kind === 'any' && t.elem.union && t.elem.union.length > 1) {
        return opts.arrayStyle === 'generic' ? `Array<${elemStr}>` : `(${elemStr})[]`;
      }
      return opts.arrayStyle === 'generic' ? `Array<${elemStr}>` : `${elemStr}[]`;
    }
    case 'object': {
      // 对象：如果有接口名则引用，否则内联
      if (t.interfaceName) return t.interfaceName;
      // 内联对象字面量类型
      return serializeInlineObject(t, opts, indent);
    }
    default:
      return 'any';
  }
}

/** 序列化内联对象字面量类型（用于无接口名的场景，如空对象） */
function serializeInlineObject(t: TypeInfo, opts: Required<JsonToTsOptions>, indent: number): string {
  if (!t.fields || t.fields.length === 0) return '{}';
  const pad = '  '.repeat(indent + 1);
  const closePad = '  '.repeat(indent);
  const parts = t.fields.map((f) => {
    const opt = f.optional ? '?' : '';
    const val = serializeType(f.type, opts, indent + 1);
    return `${pad}${sanitizeKey(f.key)}${opt}: ${val};`;
  });
  return `{\n${parts.join('\n')}\n${closePad}}`;
}

/** 序列化 interface 声明 */
function serializeInterface(name: string, t: TypeInfo, opts: Required<JsonToTsOptions>): string {
  const exportKw = opts.exportKeyword ? 'export ' : '';
  if (!t.fields || t.fields.length === 0) {
    return `${exportKw}interface ${name} {}`;
  }
  const lines = t.fields.map((f) => {
    const opt = f.optional ? '?' : '';
    const val = serializeType(f.type, opts, 1);
    return `  ${sanitizeKey(f.key)}${opt}: ${val};`;
  });
  return `${exportKw}interface ${name} {\n${lines.join('\n')}\n}`;
}

/** 键名合法性检查：非法键用引号包裹 */
function sanitizeKey(key: string): string {
  // 合法标识符：字母/下划线/$ 开头，后接字母数字下划线/$
  if (/^[A-Za-z_$][\w$]*$/.test(key)) return key;
  // 数字开头的键也合法（TS 允许），但需用引号
  return JSON.stringify(key);
}

// ============ 主入口 ============

/** 解析默认选项 */
function resolveOptions(opts: JsonToTsOptions): Required<JsonToTsOptions> {
  return {
    rootName: opts.rootName ?? 'Root',
    exportKeyword: opts.exportKeyword ?? true,
    optionalFields: opts.optionalFields ?? true,
    arrayStyle: opts.arrayStyle ?? 'bracket',
    keepNull: opts.keepNull ?? true,
  };
}

/**
 * 从 JSON 字符串生成 TypeScript 接口代码
 * @param jsonText JSON 字符串
 * @param options 生成选项
 */
export function jsonToTs(jsonText: string, options: JsonToTsOptions = {}): JsonToTsResult {
  const opts = resolveOptions(options);
  const trimmed = jsonText.trim();
  if (!trimmed) {
    return { ok: false, code: '', error: '输入为空', stats: { interfaceCount: 0, fieldCount: 0, charCount: 0, lineCount: 0 } };
  }

  let value: unknown;
  try {
    value = JSON.parse(trimmed);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, code: '', error: `JSON 解析失败：${msg}`, stats: { interfaceCount: 0, fieldCount: 0, charCount: 0, lineCount: 0 } };
  }

  // 顶层仅支持对象或数组（基本类型直接用 type 别名）
  if (value === null || (typeof value !== 'object')) {
    // 顶层为基本类型：输出 type 别名
    const exportKw = opts.exportKeyword ? 'export ' : '';
    const t = inferType(value, opts);
    const typeStr = serializeType(t, opts);
    const code = `${exportKw}type ${opts.rootName} = ${typeStr};`;
    return {
      ok: true,
      code,
      error: null,
      stats: {
        interfaceCount: 0,
        fieldCount: 0,
        charCount: code.length,
        lineCount: code.split('\n').length,
      },
    };
  }

  // 推断根类型
  const rootTypeInfo = inferType(value, opts);
  // 提取 interface（去重 + 命名）
  const { interfaces, rootType } = extractInterfaces(rootTypeInfo, opts.rootName);

  // 序列化所有 interface 声明
  const parts: string[] = [];
  for (const iface of interfaces) {
    parts.push(serializeInterface(iface.name, iface.type, opts));
  }

  // 根类型别名：仅当根不是对象（对象已作为 interface 声明，无需额外别名）
  const exportKw = opts.exportKeyword ? 'export ' : '';
  if (rootType.kind === 'array') {
    const elemStr = serializeType(rootType.elem ?? { kind: 'any' }, opts);
    const arrStr = opts.arrayStyle === 'generic' ? `Array<${elemStr}>` : `${elemStr}[]`;
    parts.push(`${exportKw}type ${opts.rootName} = ${arrStr};`);
  } else if (rootType.kind !== 'object') {
    parts.push(`${exportKw}type ${opts.rootName} = ${serializeType(rootType, opts)};`);
  }
  // 根为对象时：interface Root 即根类型，不再输出 type 别名（避免冗余）

  const code = parts.join('\n\n');

  // 统计
  let fieldCount = 0;
  for (const iface of interfaces) {
    fieldCount += iface.type.fields?.length ?? 0;
  }

  return {
    ok: true,
    code,
    error: null,
    stats: {
      interfaceCount: interfaces.length,
      fieldCount,
      charCount: code.length,
      lineCount: code.split('\n').length,
    },
  };
}

/** 对外暴露的工具函数：仅做类型推断，不生成代码（供高级用法） */
export function inferTypeInfo(value: unknown, options: JsonToTsOptions = {}): TypeInfo {
  return inferType(value, resolveOptions(options));
}
