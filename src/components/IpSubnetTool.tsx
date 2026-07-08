import { useMemo, useState, useCallback } from 'react';
import { copyText } from '../utils/clipboard';
import {
  parseCidr,
  divideSubnet,
  formatHostCount,
  IP_PRESETS,
  type SubnetInfo,
  type SubnetDivideResult,
} from '../utils/ip';

/**
 * IP / 子网计算工具
 *
 * 全部在浏览器本地处理，不发起任何网络请求。
 * 主要能力：
 *  - 输入 CIDR（如 192.168.1.0/24）或 IP / 掩码（如 10.0.0.0/255.0.0.0）
 *  - 输出网络地址、广播地址、掩码、通配符掩码、IP 范围、主机数
 *  - 类型判定（私有 / 环回 / 多播 / 链路本地 / 保留 / IP 类别）
 *  - 二进制可视化（IP 与掩码按位对齐）
 *  - 子网划分（将一个 CIDR 划分为 2/4/8/16... 个等长子网）
 *  - 12 个常用预设（家庭网络、私有段、环回、IPv6 等）
 *
 * SSR 水合：默认输入固定字符串 '192.168.1.0/24'，无时间相关数据，
 *          useMemo 中的 parseCidr 是纯函数，SSR 与 CSR 结果一致。
 */

// 子网划分可选数量（必须为 2 的幂）
const DIVIDE_OPTIONS = [2, 4, 8, 16, 32, 64, 128, 256];

export default function IpSubnetTool() {
  // 输入 CIDR：初始固定字符串，避免 SSR 水合不一致
  const [cidr, setCidr] = useState<string>('192.168.1.0/24');
  // 子网划分数
  const [divideCount, setDivideCount] = useState<number>(4);
  // 子网划分结果（按需计算，避免每次输入都重算）
  const [divideResult, setDivideResult] = useState<SubnetDivideResult | null>(null);
  const [divideError, setDivideError] = useState<string>('');
  // 复制反馈
  const [copiedField, setCopiedField] = useState<string>('');
  const [notice, setNotice] = useState<string>('');

  // 实时解析 CIDR
  const parsed = useMemo(() => parseCidr(cidr), [cidr]);
  const info: SubnetInfo | null = parsed.ok ? parsed.info : null;
  const error: string = parsed.ok ? '' : parsed.error;

  /** 复制字段值 */
  const handleCopy = useCallback(async (text: string, field: string) => {
    if (!text) return;
    const ok = await copyText(text);
    if (ok) {
      setCopiedField(field);
      setNotice('已复制到剪贴板');
      setTimeout(() => {
        setCopiedField('');
        setNotice('');
      }, 1500);
    } else {
      setNotice('复制失败，请手动选中复制');
    }
  }, []);

  /** 载入预设 */
  const handlePreset = useCallback((value: string) => {
    setCidr(value);
    setDivideResult(null);
    setDivideError('');
    setNotice('');
  }, []);

  /** 清空输入 */
  const handleClear = useCallback(() => {
    setCidr('');
    setDivideResult(null);
    setDivideError('');
    setNotice('');
  }, []);

  /** 执行子网划分 */
  const handleDivide = useCallback(() => {
    if (!info) return;
    const result = divideSubnet(cidr, divideCount);
    if (result.ok) {
      setDivideResult(result.result);
      setDivideError('');
    } else {
      setDivideResult(null);
      setDivideError(result.error);
    }
  }, [cidr, divideCount, info]);

  /** 输入框变化时清空子网划分结果 */
  const onCidrChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setCidr(e.target.value);
    setDivideResult(null);
    setDivideError('');
    if (notice) setNotice('');
  }, [notice]);

  /** 子网划分数变化时清空旧结果 */
  const onDivideCountChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    setDivideCount(Number(e.target.value));
    setDivideResult(null);
    setDivideError('');
  }, []);

  // 类型标签
  const badges: { label: string; cls: string }[] = [];
  if (info) {
    if (info.isPrivate) badges.push({ label: '私有地址', cls: 'badge--private' });
    if (info.isLoopback) badges.push({ label: '环回地址', cls: 'badge--loopback' });
    if (info.isMulticast) badges.push({ label: '多播地址', cls: 'badge--multicast' });
    if (info.isLinkLocal) badges.push({ label: '链路本地', cls: 'badge--linklocal' });
    if (info.isReserved) badges.push({ label: '保留地址', cls: 'badge--reserved' });
    if (info.isUnspecified) badges.push({ label: '未指定', cls: 'badge--unspecified' });
    if (info.ipClass) badges.push({ label: `${info.ipClass} 类`, cls: 'badge--class' });
  }

  // 主结果行（label -> value -> fieldKey）
  const resultRows: { label: string; value: string; field: string; copyable?: boolean }[] = [];
  if (info) {
    resultRows.push(
      { label: 'IP 地址', value: info.ip.compressed, field: 'ip', copyable: true },
      { label: '网络地址', value: info.networkAddress.compressed, field: 'network', copyable: true },
      {
        label: '广播地址',
        value: info.broadcastAddress ? info.broadcastAddress.compressed : '（IPv6 无广播）',
        field: 'broadcast',
        copyable: !!info.broadcastAddress,
      },
      { label: '子网掩码', value: info.netmask.compressed, field: 'netmask', copyable: true },
      { label: '通配符掩码', value: info.wildcardMask.compressed, field: 'wildcard', copyable: true },
      { label: '第一个主机', value: info.firstHost.compressed, field: 'first', copyable: true },
      { label: '最后主机', value: info.lastHost.compressed, field: 'last', copyable: true },
      { label: '总主机数', value: formatHostCount(info.totalHosts), field: 'total' },
      { label: '可用主机数', value: formatHostCount(info.usableHosts), field: 'usable' },
      { label: 'CIDR 前缀', value: `/${info.prefix}`, field: 'prefix' },
      { label: '网络位数', value: `${info.networkBits} 位`, field: 'netbits' },
      { label: '主机位数', value: `${info.hostBits} 位`, field: 'hostbits' },
    );
  }

  // 二进制视图行
  const binaryRows: { label: string; value: string; field: string }[] = [];
  if (info) {
    binaryRows.push(
      { label: 'IP 地址', value: info.ip.binary, field: 'bin-ip' },
      { label: '子网掩码', value: info.netmask.binary, field: 'bin-netmask' },
      { label: '网络地址', value: info.networkAddress.binary, field: 'bin-network' },
    );
    if (info.broadcastAddress) {
      binaryRows.push({ label: '广播地址', value: info.broadcastAddress.binary, field: 'bin-broadcast' });
    }
  }

  // IPv6 完整表示
  const ipv6FullRows: { label: string; value: string; field: string }[] = [];
  if (info && info.family === 6) {
    ipv6FullRows.push(
      { label: 'IP 完整表示', value: info.ip.full, field: 'full-ip' },
      { label: '网络地址完整', value: info.networkAddress.full, field: 'full-network' },
      { label: '掩码完整表示', value: info.netmask.full, field: 'full-netmask' },
    );
    if (info.broadcastAddress) {
      ipv6FullRows.push({ label: '广播完整表示', value: info.broadcastAddress.full, field: 'full-broadcast' });
    }
  }

  return (
    <div className="jsontool iptool">
      {/* 输入区 */}
      <div className="iptool__input-row">
        <label htmlFor="iptool-input" className="visually-hidden">
          CIDR 或 IP / 掩码
        </label>
        <input
          id="iptool-input"
          type="text"
          className="iptool__input"
          value={cidr}
          onChange={onCidrChange}
          placeholder="例如：192.168.1.0/24 或 2001:db8::/32 或 10.0.0.0/255.0.0.0"
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          aria-label="CIDR 或 IP / 掩码"
          aria-invalid={!!error}
        />
        <button className="btn btn--sm" onClick={handleClear} aria-label="清空输入">
          清空
        </button>
      </div>

      {/* 预设按钮 */}
      <div className="iptool__presets" role="group" aria-label="常用预设">
        {IP_PRESETS.map((p) => (
          <button
            key={p.value}
            type="button"
            className="btn btn--sm iptool__preset"
            onClick={() => handlePreset(p.value)}
            aria-label={`载入预设：${p.label}，表达式 ${p.value}`}
          >
            <span>{p.label}</span>
            <code>{p.value}</code>
          </button>
        ))}
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="jsontool__status" role="status" aria-live="polite">
          <div className="jsontool__error">
            <strong>❌ 错误</strong>
            <span>{error}</span>
          </div>
        </div>
      )}

      {/* 主结果 */}
      {info && (
        <>
          {/* 子网信息表格 */}
          <h3 className="iptool__section-title">子网信息</h3>
          <ul className="iptool__table" role="list">
            {resultRows.map((row) => (
              <li key={row.field} className="iptool__row">
                <span className="iptool__row-label">{row.label}</span>
                <code className="iptool__row-value">{row.value}</code>
                {row.copyable && (
                  <button
                    className="btn btn--sm"
                    onClick={() => handleCopy(row.value, row.field)}
                    aria-label={`复制${row.label}`}
                  >
                    {copiedField === row.field ? '已复制' : '复制'}
                  </button>
                )}
              </li>
            ))}
          </ul>

          {/* 类型标签 */}
          {badges.length > 0 && (
            <div className="iptool__badges">
              {badges.map((b, i) => (
                <span key={i} className={`iptool__badge ${b.cls}`}>{b.label}</span>
              ))}
            </div>
          )}

          {/* 二进制可视化 */}
          <h3 className="iptool__section-title">二进制视图</h3>
          <ul className="iptool__table iptool__table--binary" role="list">
            {binaryRows.map((row) => (
              <li key={row.field} className="iptool__row iptool__row--binary">
                <span className="iptool__row-label">{row.label}</span>
                <code className="iptool__row-value iptool__binary">{row.value}</code>
                <button
                  className="btn btn--sm"
                  onClick={() => handleCopy(row.value, row.field)}
                  aria-label={`复制${row.label}二进制`}
                >
                  {copiedField === row.field ? '已复制' : '复制'}
                </button>
              </li>
            ))}
          </ul>

          {/* IPv6 完整表示 */}
          {ipv6FullRows.length > 0 && (
            <>
              <h3 className="iptool__section-title">IPv6 完整表示（不缩略）</h3>
              <ul className="iptool__table" role="list">
                {ipv6FullRows.map((row) => (
                  <li key={row.field} className="iptool__row">
                    <span className="iptool__row-label">{row.label}</span>
                    <code className="iptool__row-value">{row.value}</code>
                    <button
                      className="btn btn--sm"
                      onClick={() => handleCopy(row.value, row.field)}
                      aria-label={`复制${row.label}`}
                    >
                      {copiedField === row.field ? '已复制' : '复制'}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}

          {/* 子网划分 */}
          <h3 className="iptool__section-title">子网划分</h3>
          <div className="iptool__divide-bar">
            <label className="iptool__divide-label">
              <span>子网数量</span>
              <select
                value={divideCount}
                onChange={onDivideCountChange}
                aria-label="子网划分数"
              >
                {DIVIDE_OPTIONS.map((n) => (
                  <option key={n} value={n}>{n} 个</option>
                ))}
              </select>
            </label>
            <button
              className="btn btn--primary btn--sm"
              onClick={handleDivide}
              aria-label={`划分为 ${divideCount} 个子网`}
            >
              划分
            </button>
            <span className="iptool__divide-hint">
              新前缀：/{info.prefix + Math.log2(divideCount)}
            </span>
          </div>

          {divideError && (
            <div className="jsontool__status" role="status" aria-live="polite">
              <div className="jsontool__error">
                <strong>❌ 错误</strong>
                <span>{divideError}</span>
              </div>
            </div>
          )}

          {divideResult && (
            <div className="iptool__divide-result" aria-live="polite">
              <p className="iptool__divide-summary">
                已将 <code>{info.input}</code> 划分为 <strong>{divideResult.count}</strong> 个
                /{divideResult.newPrefix} 子网：
              </p>
              <div className="iptool__subnets-table" role="table" aria-label="子网划分结果">
                <div className="iptool__subnets-row iptool__subnets-row--head" role="row">
                  <span role="columnheader">#</span>
                  <span role="columnheader">网络地址</span>
                  <span role="columnheader">广播地址</span>
                  <span role="columnheader">主机范围</span>
                  <span role="columnheader">可用数</span>
                </div>
                {divideResult.subnets.map((s) => (
                  <div key={s.index} className="iptool__subnets-row" role="row">
                    <span role="cell" className="iptool__subnets-idx">{s.index + 1}</span>
                    <span role="cell" className="iptool__subnets-net">{s.networkAddress.compressed}</span>
                    <span role="cell" className="iptool__subnets-bcast">
                      {s.broadcastAddress ? s.broadcastAddress.compressed : '—'}
                    </span>
                    <span role="cell" className="iptool__subnets-range">
                      {s.firstHost.compressed} ~ {s.lastHost.compressed}
                    </span>
                    <span role="cell" className="iptool__subnets-usable">
                      {formatHostCount(s.usableHosts)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* 状态条 */}
      <div className="jsontool__status" role="status" aria-live="polite">
        {notice ? (
          <div className="jsontool__notice">{notice}</div>
        ) : (
          <div className="jsontool__hint">
            所有数据仅在你浏览器内处理，不会上传到任何服务器。支持 IPv4 / IPv6 双栈与点分掩码。
          </div>
        )}
      </div>
    </div>
  );
}
