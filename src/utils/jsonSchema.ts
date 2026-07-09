/**
 * 轻量 JSON Schema 校验器（draft-07 核心子集）
 *
 * 设计目标：
 *  - 零依赖纯 TS 实现，覆盖 80% 实际使用场景的核心关键字
 *  - 返回结构化错误列表（实例路径 + 中文消息 + 关键字），便于 UI 定位展示
 *  - 支持内部 $ref 引用（#/definitions/...、#/properties/... 等），含循环引用防护
 *  - format 仅实现常见 9 种，不引入 ajv 等重型库，bundle 可控
 *
 * 支持的关键字：
 *  - 类型：type（单值或数组）、enum、const
 *  - 对象：required、properties、patternProperties、additionalProperties、minProperties、maxProperties
 *  - 数组：items（单 schema 或数组）、additionalItems、minItems、maxItems、uniqueItems
 *  - 字符串：minLength、maxLength、pattern、format（date-time/date/time/email/uri/ipv4/ipv6/uuid/hostname）
 *  - 数值：minimum、maximum、exclusiveMinimum、exclusiveMaximum、multipleOf
 *  - 组合：allOf、anyOf、oneOf、not
 *  - 引用：$ref（仅同文档内部引用，如 #/definitions/Foo）
 *  - 元信息：title、description（仅展示用，不影响校验）
 *
 * 不支持（超出轻量范围）：$id/$schema/definitions 外部引用、dependencies/if-then-else、
 *  contains、propertyNames、contentEncoding/contentMediaType、自定义 format。
 */

/** 单条校验错误 */
export interface ValidationError {
  /** 实例路径，JSON Pointer 风格，如 "" / "/users/0/name" */
  path: string;
  /** 中文错误消息 */
  message: string;
  /** 触发关键字，如 "type"、"required"、"minLength" */
  keyword: string;
}

/** 校验结果 */
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

/** JSON Schema 中 type 字段允许的类型名 */
type JsonType = 'null' | 'boolean' | 'object' | 'array' | 'number' | 'string' | 'integer';

/** format 校验函数表 */
const FORMAT_VALIDATORS: Record<string, (v: string) => boolean> = {
  'date-time': (v) => !Number.isNaN(Date.parse(v)) && /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/.test(v),
  'date': (v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v + 'T00:00:00Z')),
  'time': (v) => /^\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/.test(v),
  'email': (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
  'uri': (v) => /^[a-z][a-z0-9+.-]*:/i.test(v) && !/\s/.test(v),
  'ipv4': (v) => /^((25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(25[0-5]|2[0-4]\d|1?\d?\d)$/.test(v),
  'ipv6': (v) => /^([0-9a-f]{1,4}(:[0-9a-f]{1,4}){7}|::|([0-9a-f]{1,4}:)?(:[0-9a-f]{1,4}){1,6})$/i.test(v),
  'uuid': (v) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v),
  'hostname': (v) => /^(?=.{1,253}$)([a-z0-9-]{1,63}\.)+[a-z0-9-]{1,63}$/i.test(v),
};

/** 判断 JS 值是否匹配 JSON Schema 类型名（integer 限定无小数） */
function matchType(value: unknown, type: JsonType): boolean {
  if (value === null) return type === 'null';
  if (typeof value === 'boolean') return type === 'boolean';
  if (Array.isArray(value)) return type === 'array';
  if (typeof value === 'object') return type === 'object';
  if (typeof value === 'string') return type === 'string';
  if (typeof value === 'number') {
    if (type === 'number') return true;
    if (type === 'integer') return Number.isInteger(value);
    return false;
  }
  return false;
}

/** 深度相等比较（用于 enum / const / uniqueItems） */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  }
  if (typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a as object);
    const kb = Object.keys(b as object);
    return ka.length === kb.length && ka.every((k) => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
  }
  return false;
}

/** 按 JSON Pointer 路径从 root 解析节点（仅支持 #/a/b/0 这种内部引用） */
function resolveRef(ref: string, root: unknown): unknown {
  if (!ref.startsWith('#/')) return undefined;
  // 拆分路径段，~1 → /，~0 → ~（JSON Pointer 转义反转）
  const parts = ref.slice(2).split('/').map((p) => p.replace(/~1/g, '/').replace(/~0/g, '~'));
  let cur: unknown = root;
  for (const p of parts) {
    if (cur && typeof cur === 'object') {
      cur = (cur as Record<string, unknown>)[p];
    } else {
      return undefined;
    }
  }
  return cur;
}

/** 拼接实例路径段（数字索引用 [i]，字符串用 /key） */
function joinPath(base: string, key: string | number): string {
  if (typeof key === 'number') return `${base}[${key}]`;
  return base === '' ? `/${key}` : `${base}/${key}`;
}

/**
 * 核心校验递归函数
 * @param instance 待校验的 JS 值
 * @param schema 当前节点的 schema
 * @param path 当前实例路径
 * @param root schema 根节点（用于解析 $ref）
 * @param refStack $ref 解析栈，防止循环引用
 * @param errors 收集错误列表
 */
function validateNode(
  instance: unknown,
  schema: unknown,
  path: string,
  root: unknown,
  refStack: string[],
  errors: ValidationError[],
): void {
  // schema 为 boolean：true 任意通过，false 任意失败
  if (schema === true) return;
  if (schema === false) {
    errors.push({ path, message: '该位置不允许任何值（schema 为 false）', keyword: 'false' });
    return;
  }
  if (!schema || typeof schema !== 'object') return;

  const sch = schema as Record<string, unknown>;

  // $ref：解析引用并递归校验，循环引用时跳过避免无限递归
  if (typeof sch.$ref === 'string') {
    if (refStack.includes(sch.$ref)) return;
    const target = resolveRef(sch.$ref, root);
    if (target === undefined) {
      errors.push({ path, message: `无法解析 $ref：${sch.$ref}`, keyword: '$ref' });
      return;
    }
    validateNode(instance, target, path, root, [...refStack, sch.$ref], errors);
    return;
  }

  // type：单值或数组
  if (sch.type !== undefined) {
    const types = Array.isArray(sch.type) ? sch.type : [sch.type];
    const ok = types.some((t) => matchType(instance, t as JsonType));
    if (!ok) {
      errors.push({
        path,
        message: `期望类型 ${types.join(' | ')}，实际为 ${actualTypeOf(instance)}`,
        keyword: 'type',
      });
      // 类型不匹配时，后续关键字校验意义不大，直接返回
      return;
    }
  }

  // enum：值必须在枚举列表中
  if (Array.isArray(sch.enum)) {
    if (!sch.enum.some((e) => deepEqual(e, instance))) {
      errors.push({ path, message: `值不在 enum 列表中`, keyword: 'enum' });
    }
  }

  // const：值必须严格等于 const
  if (sch.const !== undefined) {
    if (!deepEqual(sch.const, instance)) {
      errors.push({ path, message: `值不等于 const 约定值`, keyword: 'const' });
    }
  }

  // 数值类关键字（仅 number/integer 触发）
  if (typeof instance === 'number') {
    if (typeof sch.minimum === 'number' && instance < sch.minimum) {
      errors.push({ path, message: `值 ${instance} 小于最小值 ${sch.minimum}`, keyword: 'minimum' });
    }
    if (typeof sch.maximum === 'number' && instance > sch.maximum) {
      errors.push({ path, message: `值 ${instance} 大于最大值 ${sch.maximum}`, keyword: 'maximum' });
    }
    if (typeof sch.exclusiveMinimum === 'number' && instance <= sch.exclusiveMinimum) {
      errors.push({ path, message: `值 ${instance} 须严格大于 exclusiveMinimum ${sch.exclusiveMinimum}`, keyword: 'exclusiveMinimum' });
    }
    if (typeof sch.exclusiveMaximum === 'number' && instance >= sch.exclusiveMaximum) {
      errors.push({ path, message: `值 ${instance} 须严格小于 exclusiveMaximum ${sch.exclusiveMaximum}`, keyword: 'exclusiveMaximum' });
    }
    if (typeof sch.multipleOf === 'number' && sch.multipleOf > 0) {
      const r = (instance / sch.multipleOf);
      if (Math.abs(r - Math.round(r)) > 1e-10) {
        errors.push({ path, message: `值 ${instance} 不是 ${sch.multipleOf} 的整数倍`, keyword: 'multipleOf' });
      }
    }
  }

  // 字符串类关键字
  if (typeof instance === 'string') {
    if (typeof sch.minLength === 'number' && [...instance].length < sch.minLength) {
      errors.push({ path, message: `字符串长度 ${[...instance].length} 小于 minLength ${sch.minLength}`, keyword: 'minLength' });
    }
    if (typeof sch.maxLength === 'number' && [...instance].length > sch.maxLength) {
      errors.push({ path, message: `字符串长度 ${[...instance].length} 大于 maxLength ${sch.maxLength}`, keyword: 'maxLength' });
    }
    if (typeof sch.pattern === 'string') {
      // 限制 pattern 与被匹配字符串长度，防御恶意回溯型正则导致 ReDoS
      if (sch.pattern.length > 1000) {
        errors.push({ path, message: 'pattern 长度超过 1000 字符，已跳过校验以防 ReDoS', keyword: 'pattern' });
      } else if (instance.length > 100000) {
        errors.push({ path, message: '字符串长度超过 100000，已跳过 pattern 校验以防 ReDoS', keyword: 'pattern' });
      } else {
        try {
          const re = new RegExp(sch.pattern);
          if (!re.test(instance)) {
            errors.push({ path, message: `字符串不匹配 pattern ${sch.pattern}`, keyword: 'pattern' });
          }
        } catch {
          errors.push({ path, message: `pattern 非法：${sch.pattern}`, keyword: 'pattern' });
        }
      }
    }
    if (typeof sch.format === 'string' && FORMAT_VALIDATORS[sch.format]) {
      if (!FORMAT_VALIDATORS[sch.format](instance)) {
        errors.push({ path, message: `字符串不符合 format ${sch.format}`, keyword: 'format' });
      }
    }
  }

  // 数组类关键字
  if (Array.isArray(instance)) {
    if (typeof sch.minItems === 'number' && instance.length < sch.minItems) {
      errors.push({ path, message: `数组长度 ${instance.length} 小于 minItems ${sch.minItems}`, keyword: 'minItems' });
    }
    if (typeof sch.maxItems === 'number' && instance.length > sch.maxItems) {
      errors.push({ path, message: `数组长度 ${instance.length} 大于 maxItems ${sch.maxItems}`, keyword: 'maxItems' });
    }
    if (sch.uniqueItems === true) {
      // 两两比较去重，O(n²) 但实现简单且对常见规模足够
      for (let i = 0; i < instance.length; i++) {
        for (let j = i + 1; j < instance.length; j++) {
          if (deepEqual(instance[i], instance[j])) {
            errors.push({ path, message: `数组含重复元素（位置 ${i} 与 ${j}），违反 uniqueItems`, keyword: 'uniqueItems' });
            break;
          }
        }
      }
    }
    // items：单 schema 应用于所有元素，或数组 schema 按位置应用
    if (sch.items !== undefined) {
      if (Array.isArray(sch.items)) {
        // 元组模式：每个位置对应一个 schema
        for (let i = 0; i < sch.items.length && i < instance.length; i++) {
          validateNode(instance[i], sch.items[i], joinPath(path, i), root, refStack, errors);
        }
        // additionalItems：超出元组长度的元素
        if (sch.additionalItems !== undefined && instance.length > sch.items.length) {
          if (sch.additionalItems === false) {
            errors.push({ path, message: `数组长度 ${instance.length} 超出元组定义长度 ${sch.items.length}，且 additionalItems 为 false`, keyword: 'additionalItems' });
          } else if (typeof sch.additionalItems === 'object') {
            for (let i = sch.items.length; i < instance.length; i++) {
              validateNode(instance[i], sch.additionalItems, joinPath(path, i), root, refStack, errors);
            }
          }
        }
      } else {
        // 单 schema：应用于所有元素
        for (let i = 0; i < instance.length; i++) {
          validateNode(instance[i], sch.items, joinPath(path, i), root, refStack, errors);
        }
      }
    }
  }

  // 对象类关键字
  if (instance && typeof instance === 'object' && !Array.isArray(instance)) {
    const obj = instance as Record<string, unknown>;
    const keys = Object.keys(obj);

    if (typeof sch.minProperties === 'number' && keys.length < sch.minProperties) {
      errors.push({ path, message: `属性数 ${keys.length} 小于 minProperties ${sch.minProperties}`, keyword: 'minProperties' });
    }
    if (typeof sch.maxProperties === 'number' && keys.length > sch.maxProperties) {
      errors.push({ path, message: `属性数 ${keys.length} 大于 maxProperties ${sch.maxProperties}`, keyword: 'maxProperties' });
    }

    // required：检查必填属性是否存在
    if (Array.isArray(sch.required)) {
      for (const req of sch.required) {
        if (typeof req === 'string' && !(req in obj)) {
          errors.push({ path, message: `缺少必填属性：${req}`, keyword: 'required' });
        }
      }
    }

    const properties = sch.properties as Record<string, unknown> | undefined;
    const patternProperties = sch.patternProperties as Record<string, unknown> | undefined;

    // 遍历实例属性，应用 properties / patternProperties / additionalProperties
    for (const key of keys) {
      let matched = false;
      // properties：精确键名匹配
      if (properties && properties[key] !== undefined) {
        matched = true;
        validateNode(obj[key], properties[key], joinPath(path, key), root, refStack, errors);
      }
      // patternProperties：正则匹配键名
      if (patternProperties) {
        for (const [pat, sub] of Object.entries(patternProperties)) {
          // 限制正则与键名长度，防御恶意回溯型正则导致 ReDoS
          if (pat.length > 1000 || key.length > 100000) continue;
          try {
            if (new RegExp(pat).test(key)) {
              matched = true;
              validateNode(obj[key], sub, joinPath(path, key), root, refStack, errors);
            }
          } catch {
            // 非法正则忽略，避免影响其他校验
          }
        }
      }
      // additionalProperties：未匹配的额外属性处理
      if (!matched && sch.additionalProperties !== undefined) {
        if (sch.additionalProperties === false) {
          errors.push({ path: joinPath(path, key), message: `存在未定义的额外属性：${key}，且 additionalProperties 为 false`, keyword: 'additionalProperties' });
        } else if (typeof sch.additionalProperties === 'object') {
          validateNode(obj[key], sch.additionalProperties, joinPath(path, key), root, refStack, errors);
        }
      }
    }
  }

  // allOf：所有子 schema 必须全部通过
  if (Array.isArray(sch.allOf)) {
    for (const sub of sch.allOf) {
      const before = errors.length;
      validateNode(instance, sub, path, root, refStack, errors);
      // allOf 子节点失败不中断，继续校验其他子节点，便于一次性收集所有错误
      void before;
    }
  }

  // anyOf：至少一个子 schema 通过
  if (Array.isArray(sch.anyOf)) {
    const passed = sch.anyOf.some((sub) => {
      const tmp: ValidationError[] = [];
      validateNode(instance, sub, path, root, refStack, tmp);
      return tmp.length === 0;
    });
    if (!passed) {
      errors.push({ path, message: `值不满足 anyOf 中任何一个子 schema`, keyword: 'anyOf' });
    }
  }

  // oneOf：恰好一个子 schema 通过
  if (Array.isArray(sch.oneOf)) {
    const passCount = sch.oneOf.reduce((cnt, sub) => {
      const tmp: ValidationError[] = [];
      validateNode(instance, sub, path, root, refStack, tmp);
      return tmp.length === 0 ? cnt + 1 : cnt;
    }, 0);
    if (passCount !== 1) {
      errors.push({ path, message: `值需恰好匹配 oneOf 中一个子 schema，实际匹配 ${passCount} 个`, keyword: 'oneOf' });
    }
  }

  // not：子 schema 必须不通过
  if (sch.not !== undefined) {
    const tmp: ValidationError[] = [];
    validateNode(instance, sch.not, path, root, refStack, tmp);
    if (tmp.length === 0) {
      errors.push({ path, message: `值不应匹配 not 中的子 schema`, keyword: 'not' });
    }
  }
}

/** 获取值的实际类型名（用于错误消息） */
function actualTypeOf(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  return typeof value;
}

/**
 * 校验入口：用 schema 校验 instance，返回错误列表
 * @param instance 待校验的 JS 值
 * @param schema JSON Schema 对象
 * @returns 校验结果，valid=true 表示无错误
 */
export function validate(instance: unknown, schema: unknown): ValidationResult {
  const errors: ValidationError[] = [];
  validateNode(instance, schema, '', schema, [], errors);
  return { valid: errors.length === 0, errors };
}
