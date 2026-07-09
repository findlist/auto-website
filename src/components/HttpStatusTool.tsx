import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { copyText } from '../utils/clipboard';
import {
  HTTP_STATUS_CODES,
  CATEGORY_METAS,
  searchStatuses,
  getCategoryMeta,
  getStatusStats,
  type StatusCategory,
} from '../utils/httpStatus';

/**
 * HTTP 状态码参考查询器
 *
 * 设计要点：
 *  - 纯客户端查询，零网络请求，零依赖
 *  - 搜索 + 分类筛选双重过滤
 *  - 卡片点击展开详情（accordion 模式），相关状态码可跳转
 *  - 复制状态码、复制完整说明
 *  - 暗色模式、移动端响应式
 */
export default function HttpStatusTool() {
  const [query, setQuery] = useState<string>('');
  const [activeCategory, setActiveCategory] = useState<StatusCategory | 'all'>('all');
  const [selectedCode, setSelectedCode] = useState<number | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const detailRef = useRef<HTMLDivElement | null>(null);

  // 过滤结果
  const filtered = useMemo(
    () => searchStatuses(query, activeCategory),
    [query, activeCategory],
  );

  // 统计信息
  const stats = useMemo(() => getStatusStats(), []);

  // 当前选中的状态码完整信息
  const selected = useMemo(
    () => (selectedCode === null ? null : filtered.find((s) => s.code === selectedCode) ?? null),
    [selectedCode, filtered],
  );

  /** 复制状态码或说明 */
  const handleCopy = useCallback(async (value: string, field: string) => {
    const ok = await copyText(value);
    if (ok) {
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 1500);
    }
  }, []);

  /** 切换卡片展开/收起 */
  const handleToggle = useCallback((code: number) => {
    setSelectedCode((prev) => (prev === code ? null : code));
  }, []);

  /** 点击相关状态码跳转 */
  const handleRelatedClick = useCallback((code: number) => {
    setSelectedCode(code);
    // 切换分类到目标状态码所属类别，确保可见
    const target = HTTP_STATUS_CODES.find((s) => s.code === code);
    if (target && activeCategory !== 'all' && target.category !== activeCategory) {
      setActiveCategory('all');
      setQuery('');
    }
  }, [activeCategory]);

  /** 清空筛选 */
  const handleClear = useCallback(() => {
    setQuery('');
    setActiveCategory('all');
    setSelectedCode(null);
  }, []);

  // 选中状态码变化时滚动到详情区
  useEffect(() => {
    if (selected && detailRef.current) {
      // 小延迟确保 DOM 已渲染
      const timer = setTimeout(() => {
        detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [selected]);

  return (
    <div className="httpstat">
      {/* 搜索栏 */}
      <div className="httpstat__search-bar">
        <input
          type="search"
          className="httpstat__search"
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
          placeholder="搜索状态码、名称、描述、场景，如 404、Not Found、未认证、限流"
          aria-label="搜索 HTTP 状态码"
          spellCheck={false}
        />
        {(query || activeCategory !== 'all' || selectedCode !== null) && (
          <button
            type="button"
            className="httpstat__clear-btn"
            onClick={handleClear}
            aria-label="清空筛选"
          >
            清空
          </button>
        )}
      </div>

      {/* 分类筛选 */}
      <div className="httpstat__categories" role="tablist" aria-label="按状态码大类筛选">
        <button
          type="button"
          role="tab"
          aria-selected={activeCategory === 'all'}
          className={`httpstat__category-btn${activeCategory === 'all' ? ' is-active' : ''}`}
          onClick={() => setActiveCategory('all')}
        >
          全部 <span className="httpstat__count">{stats.all}</span>
        </button>
        {CATEGORY_METAS.map((cat) => (
          <button
            key={cat.code}
            type="button"
            role="tab"
            aria-selected={activeCategory === cat.code}
            className={`httpstat__category-btn${activeCategory === cat.code ? ' is-active' : ''}`}
            style={activeCategory === cat.code ? { borderColor: cat.color, color: cat.color } : {}}
            onClick={() => setActiveCategory(cat.code)}
          >
            {cat.code} <span className="httpstat__count">{stats[cat.code]}</span>
          </button>
        ))}
      </div>

      {/* 当前分类说明 */}
      {activeCategory !== 'all' && (
        <p className="httpstat__category-desc">
          {getCategoryMeta(activeCategory)?.description}
        </p>
      )}

      {/* 结果统计 */}
      <div className="httpstat__stats" aria-live="polite">
        共 <strong>{filtered.length}</strong> 个状态码
        {activeCategory !== 'all' && <> · 类别：<strong>{activeCategory}</strong></>}
        {query.trim() && <> · 搜索：「<strong>{query.trim()}</strong>」</>}
      </div>

      {/* 空状态 */}
      {filtered.length === 0 ? (
        <div className="httpstat__empty" role="status">
          <p>未找到匹配的 HTTP 状态码。</p>
          <p className="httpstat__empty-hint">尝试更换关键词或切换大类筛选。</p>
        </div>
      ) : (
        <ul className="httpstat__list" role="list">
          {filtered.map((s) => {
            const cat = getCategoryMeta(s.category);
            const color = cat?.color ?? '#6b7280';
            const isExpanded = selectedCode === s.code;
            const codeField = `code-${s.code}`;
            return (
              <li
                key={s.code}
                className={`httpstat__item${isExpanded ? ' is-expanded' : ''}`}
                style={{ borderLeftColor: color }}
              >
                {/* 卡片头部（可点击展开） */}
                <button
                  type="button"
                  className="httpstat__item-header"
                  onClick={() => handleToggle(s.code)}
                  aria-expanded={isExpanded}
                  aria-controls={`httpstat-detail-${s.code}`}
                >
                  <span
                    className="httpstat__code"
                    style={{ backgroundColor: `${color}1a`, color: color }}
                  >
                    {s.code}
                  </span>
                  <span className="httpstat__name">{s.name}</span>
                  <span className="httpstat__desc">{s.description}</span>
                  {s.common && <span className="httpstat__common-badge">常见</span>}
                  <span className={`httpstat__chevron${isExpanded ? ' is-open' : ''}`} aria-hidden="true">▾</span>
                </button>

                {/* 展开详情 */}
                {isExpanded && (
                  <div
                    id={`httpstat-detail-${s.code}`}
                    ref={selectedCode === s.code ? detailRef : undefined}
                    className="httpstat__detail"
                  >
                    {/* 复制状态码按钮 */}
                    <div className="httpstat__detail-actions">
                      <button
                        type="button"
                        className="httpstat__copy-btn"
                        onClick={() => handleCopy(String(s.code), codeField)}
                        aria-label={`复制状态码 ${s.code}`}
                      >
                        {copiedField === codeField ? '✓ 已复制' : `复制 ${s.code}`}
                      </button>
                    </div>

                    <dl className="httpstat__fields">
                      <div className="httpstat__field">
                        <dt>详细说明</dt>
                        <dd>{s.detail}</dd>
                      </div>
                      <div className="httpstat__field">
                        <dt>典型场景</dt>
                        <dd>{s.scene}</dd>
                      </div>
                      {s.commonCause && (
                        <div className="httpstat__field">
                          <dt>常见原因</dt>
                          <dd>{s.commonCause}</dd>
                        </div>
                      )}
                      {s.troubleshooting && (
                        <div className="httpstat__field">
                          <dt>排查建议</dt>
                          <dd>{s.troubleshooting}</dd>
                        </div>
                      )}
                      <div className="httpstat__field">
                        <dt>RESTful 用法</dt>
                        <dd>{s.restfulUsage}</dd>
                      </div>
                      {s.commonHeaders && s.commonHeaders.length > 0 && (
                        <div className="httpstat__field">
                          <dt>常配合响应头</dt>
                          <dd>
                          <ul className="httpstat__headers">
                            {s.commonHeaders.map((h) => (
                              <li key={h}><code>{h}</code></li>
                            ))}
                          </ul>
                          </dd>
                        </div>
                      )}
                      {s.relatedCodes && s.relatedCodes.length > 0 && (
                        <div className="httpstat__field">
                          <dt>相关状态码对比</dt>
                          <dd>
                          <ul className="httpstat__related">
                            {s.relatedCodes.map((r) => (
                              <li key={r.code}>
                                <button
                                  type="button"
                                  className="httpstat__related-btn"
                                  onClick={() => handleRelatedClick(r.code)}
                                  aria-label={`查看 ${r.code} ${r.name}`}
                                >
                                  <strong>{r.code}</strong> {r.name}
                                </button>
                                <span className="httpstat__related-diff">{r.difference}</span>
                              </li>
                            ))}
                          </ul>
                          </dd>
                        </div>
                      )}
                    </dl>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* 选中状态码但被筛选隐藏时的提示 */}
      {selectedCode !== null && !selected && (
        <p className="httpstat__hidden-hint">
          已选状态码 {selectedCode} 被当前筛选隐藏，<button type="button" className="httpstat__link-btn" onClick={handleClear}>清空筛选</button> 查看全部。
        </p>
      )}
    </div>
  );
}
