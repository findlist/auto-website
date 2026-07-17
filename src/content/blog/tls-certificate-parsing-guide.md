---
title: "TLS 证书深度解析：从 PEM 编码到 X.509 字段与 PKI 信任链"
description: "系统讲解 TLS/SSL 证书的底层结构：PEM 与 DER 编码差异、ASN.1 DER 解析原理、X.509 v3 全部核心字段（版本/序列号/签发者/有效期/主体/公钥/扩展/签名）、SAN 替代 CN 的原因、basicConstraints/keyUsage/EKU/SAN/AKI/SKI 等关键扩展、证书链构造与 PKI 信任体系、CRL/OCSP/SCT 撤销与透明度机制、RSA/ECDSA/Ed25519 密钥算法选型、运维排查清单。结合在线 TLS 证书解析工具实操，帮你彻底看懂 HTTPS 证书。"
pubDate: 2026-07-18
tags: ["TLS", "SSL", "X.509", "PEM", "DER", "ASN.1", "证书链", "PKI", "CA", "Let's Encrypt", "RSA", "ECDSA", "Ed25519", "SAN", "OCSP", "CRL", "SCT", "证书透明度", "HTTPS"]
relatedTool: "/tls"
---

## 为什么 TLS 证书是 HTTPS 的信任基石

每个开发者都见过浏览器地址栏的小锁图标，但很少有人能说清楚锁背后的证书到底包含了什么、为什么浏览器会信任它。遇到这些问题时，理解 TLS 证书结构就是必修课：

- 浏览器报 `NET::ERR_CERT_AUTHORITY_INVALID`，证书由谁签发，为什么不信任
- 续期 Let's Encrypt 证书后，部分老客户端报「证书链不完整」
- 自签证书在 Chrome 中不报错，但在 curl 中报 `unable to get local issuer certificate`
- 证书明明还没过期，浏览器却提示「证书无效」
- 同一张证书在不同浏览器中 SAN 列表显示不一致
- 服务器发送的证书链中含 3 张证书，但客户端只接受 2 张
- 私有 CA 签发的证书在某些设备上工作正常，在另一些设备上完全无法验证

这些场景的底层都是同一套机制：**X.509 证书结构 + ASN.1 编码 + PKI 信任链 + 扩展字段语义**。理解了它们，你就能在 1 分钟内回答「这张证书是谁签的」「为什么浏览器拒绝」「需要补什么中间证书」「为什么 SAN 比 CN 重要」这类问题。

> 配套工具：[TLS 证书解析工具](/tls)（纯浏览器本地解析 + 指纹计算 + OpenSSL 文本导出）、[DNS 查询工具](/dns)（HTTPS 调试链路）、[JWT 解码](/jwt)（同属 ASN.1 编码体系）

## 一、PEM 与 DER：证书的两种编码格式

### 1.1 同一份证书，两种存储方式

X.509 证书的逻辑结构由 RFC 5280 定义为 ASN.1 数据结构，但实际存储与传输时需要编码为字节序列。两种主流编码格式：

- **DER（Distinguished Encoding Rules）**：二进制 ASN.1 编码，紧凑不可读，每张证书约 1-3KB。Windows `.cer` 文件、Java KeyStore 默认使用 DER
- **PEM（Privacy-Enhanced Mail）**：Base64 编码 DER + 头尾标记，文本格式便于阅读与复制。Linux/Mac `.pem`、`.crt` 文件、Nginx/Apache 配置默认使用 PEM

两者的内容完全等价，可以无损互转：

```bash
# PEM → DER
openssl x509 -in cert.pem -outform DER -out cert.der

# DER → PEM
openssl x509 -in cert.der -inform DER -outform PEM -out cert.pem
```

### 1.2 PEM 文件结构

PEM 文件的标准结构：

```
-----BEGIN CERTIFICATE-----
MIIFazCCA1OgAwIBAgIRAIIQz7DSQONZRGPgu2OCiwAwDQYJKoZIhvcNAQEL
BQAwTzELMAkGA1UEBhMCVVMxKTAnBgNVBAoTIEludGVybmV0IFNlY3VyaXR5
...（省略 N 行 Base64，每行 64 字符）
DlqZLQ9cl2HmTk2rlUqOF7RTa93iyx3Z2pi0xNQhg4Um4gUg8BmVZ8MT3oV
mmJ4JgyAv2c3pNQtcy3muFwP3py9wq4uD4x9PN3Nu8vPmA0zIdSEmQm0TKv0
-----END CERTIFICATE-----
```

特点：

- **头尾标记**：`-----BEGIN <LABEL>-----` 与 `-----END <LABEL>-----`，LABEL 标识块类型
- **常见 LABEL**：`CERTIFICATE`（证书）、`PRIVATE KEY`（PKCS#8 私钥）、`RSA PRIVATE KEY`（PKCS#1 RSA 私钥）、`EC PRIVATE KEY`（SEC1 EC 私钥）、`CERTIFICATE REQUEST`（CSR）
- **Base64 内容**：每行 64 字符（最后行可短），换行符为 `\n`（Linux）或 `\r\n`（Windows）
- **多块共存**：一个 `.pem` 文件可含多个块，常用于证书链（终端证书 + 中间证书）

### 1.3 文件后缀的陷阱

文件后缀不能可靠判断格式，需查看文件头判断：

| 后缀 | 通常格式 | 说明 |
|------|----------|------|
| `.pem` | PEM | Linux 通用文本格式 |
| `.crt` | PEM 或 DER | Linux/Unix 通用，需查看文件头 |
| `.cer` | DER（多数情况） | Windows 惯用，二进制 |
| `.der` | DER | 明确标识 DER 格式 |
| `.key` | PEM | 私钥文件，文本格式 |
| `.p12` / `.pfx` | PKCS#12 | 含证书 + 私钥的二进制容器，需密码保护 |

本工具支持 PEM、裸 Base64、纯 hex 三种输入。DER 二进制需先用 openssl 转换为 PEM。

## 二、ASN.1 与 DER 编码：从字节到字段的解析原理

### 2.1 ASN.1 是什么

**ASN.1（Abstract Syntax Notation One）**是 ITU-T X.680 定义的跨平台数据结构描述语言，类似 Protobuf 或 Thrift，但出现得更早（1988 年）。X.509 证书用 ASN.1 描述结构，DER 是其编码规则之一。

X.509 证书的 ASN.1 定义（简化版）：

```asn1
Certificate ::= SEQUENCE {
    tbsCertificate       TBSCertificate,
    signatureAlgorithm   AlgorithmIdentifier,
    signatureValue       BIT STRING
}

TBSCertificate ::= SEQUENCE {
    version         [0] EXPLICIT Version DEFAULT v1,
    serialNumber         CertificateSerialNumber,
    signature            AlgorithmIdentifier,
    issuer               Name,
    validity             Validity,
    subject              Name,
    subjectPublicKeyInfo SubjectPublicKeyInfo,
    issuerUniqueID  [1] IMPLICIT BIT STRING OPTIONAL,
    subjectUniqueID [2] IMPLICIT BIT STRING OPTIONAL,
    extensions      [3] EXPLICIT Extensions OPTIONAL
}
```

### 2.2 DER 编码三大要素

每个 ASN.1 节点 DER 编码为 **TLV（Tag-Length-Value）** 三段：

**Tag（标签字节）**：标识类型、类别、是否构造

```
+---+---+---+---+---+---+---+---+
| Class  |C|   Tag Number      |
+---+---+---+---+---+---+---+---+
```

- **Class（高 2 位）**：00=UNIVERSAL、01=APPLICATION、10=CONTEXT、11=PRIVATE
- **C（构造位，第 6 位）**：1=构造类型（含子节点）、0=原始类型
- **Tag Number（低 5 位）**：0-30 直接表示，31 表示多字节 tag

常见 UNIVERSAL 类型：

| Tag | 类型 | 说明 |
|-----|------|------|
| 0x02 | INTEGER | 整数（含证书序列号、RSA 模数） |
| 0x03 | BIT STRING | 位串（含公钥、签名值） |
| 0x04 | OCTET STRING | 字节串（含扩展值） |
| 0x05 | NULL | 空值（RSA 算法参数） |
| 0x06 | OID | 对象标识符（算法、扩展 ID） |
| 0x0C | UTF8String | UTF-8 字符串 |
| 0x13 | PrintableString | ASCII 子集字符串 |
| 0x16 | IA5String | ASCII 字符串（含 URL） |
| 0x17 | UTCTime | UTC 时间（YYMMDDHHMMSSZ，2050 年前） |
| 0x18 | GeneralizedTime | 通用时间（YYYYMMDDHHMMSSZ，2050 年后） |
| 0x30 | SEQUENCE | 序列（构造类型） |
| 0x31 | SET | 集合（构造类型，DN 中常用） |

**Length（长度字段）**：

- **短格式**：长度 < 128 时，单字节直接表示
- **长格式**：长度 >= 128 时，首字节高位置 1，低 7 位表示后续长度字节数

```
短格式：0x40 = 64 字节
长格式：0x82 0x01 0x2C = 300 字节（0x82 高位置 1，低 7 位 = 2 表示后续 2 字节为长度）
```

**Value（内容）**：实际数据。构造类型的 Value 是子节点的 TLV 拼接。

### 2.3 EXPLICIT 与 IMPLICIT 标签

X.509 中常见 `[n]` 标签修饰：

- **EXPLICIT [n]**：在外层包一层 CONTEXT[n] 标签，原节点完整保留。如 `version [0] EXPLICIT Version`：外层是构造的 `[0]`，内部是真正的 INTEGER
- **IMPLICIT [n]**：用 CONTEXT[n] 直接替换原节点的 tag。如 `issuerUniqueID [1] IMPLICIT BIT STRING`：直接用 `[1]` 替换 BIT STRING 的 tag

X.509 默认模块标签是 IMPLICIT TAGS，但 `version [0]` 和 `extensions [3]` 明确写了 EXPLICIT，所以解析时需特别处理。

本工具的 ASN.1 解析器递归下降处理 TLV，对 EXPLICIT 标签取 `children[0]` 即可获得真正的值，对 IMPLICIT 标签直接按上下文特定类型处理。

### 2.4 OID：算法与扩展的全球唯一标识

**OID（Object Identifier）**是 ASN.1 中标识算法、属性、扩展的全球唯一编号，形如 `1.2.840.113549.1.1.11`。常见 OID 速查：

| OID | 名称 | 用途 |
|-----|------|------|
| `1.2.840.113549.1.1.1` | rsaEncryption | RSA 公钥 |
| `1.2.840.113549.1.1.11` | sha256WithRSAEncryption | RSA + SHA-256 签名 |
| `1.2.840.10045.2.1` | ecPublicKey | EC 公钥 |
| `1.2.840.10045.4.3.2` | ecdsa-with-SHA256 | ECDSA + SHA-256 签名 |
| `1.3.101.112` | Ed25519 | EdDSA Ed25519 |
| `2.5.4.3` | commonName | CN 属性 |
| `2.5.29.17` | subjectAltName | SAN 扩展 |
| `2.5.29.19` | basicConstraints | CA 与路径长度约束 |
| `2.5.29.35` | authorityKeyIdentifier | AKI（签发者密钥标识） |
| `2.5.29.37` | extKeyUsage | EKU（扩展密钥用途） |
| `1.3.6.1.5.5.7.1.1` | authorityInfoAccess | AIA（OCSP 与 CA Issuers） |
| `1.3.6.1.4.1.11129.2.4.2` | signedCertificateTimestampList | SCT（证书透明度） |

本工具内置了 50+ 常见 OID 的友好名映射，未识别的 OID 显示原始数字串。

## 三、X.509 v3 核心字段详解

### 3.1 版本（Version）

X.509 历史版本：

- **v1（1988）**：基础字段，无扩展
- **v2（1993）**：新增 issuerUniqueID 与 subjectUniqueID（已弃用）
- **v3（2008 RFC 5280）**：新增 extensions，现代证书全部为 v3

`version` 字段是 EXPLICIT [0]，值为 0 表示 v1、1 表示 v2、2 表示 v3。本工具显示为 `v1/v2/v3` 便于阅读。

### 3.2 序列号（Serial Number）

CA 签发证书时分配的唯一编号，**正整数**，长度通常 8-20 字节（64-160 位）。Let's Encrypt 的序列号为 20 字节，包含随机数防枚举。

DER 中 INTEGER 是大端字节序，正数最高位若为 1 需前补 `0x00`（避免被解释为负数），所以解析时要去掉前导 0。

序列号在 CRL（证书撤销列表）中用于定位被撤销的证书：CA 维护一份已撤销证书的序列号列表，客户端校验时检查当前证书的序列号是否在列表中。

### 3.3 签名算法（Signature Algorithm）

证书的 `signatureAlgorithm` 字段标识 CA 用什么算法对 tbsCertificate 签名。常见：

| 算法 | OID | 说明 |
|------|-----|------|
| sha256WithRSAEncryption | 1.2.840.113549.1.1.11 | RSA + SHA-256，兼容性最好 |
| sha384WithRSAEncryption | 1.2.840.113549.1.1.12 | RSA + SHA-384 |
| ecdsa-with-SHA256 | 1.2.840.10045.4.3.2 | ECDSA + SHA-256，Let's Encrypt 主流 |
| ecdsa-with-SHA384 | 1.2.840.10045.4.3.3 | ECDSA + SHA-384 |
| Ed25519 | 1.3.101.112 | EdDSA，性能最优 |
| rsassaPss | 1.2.840.113549.1.1.10 | RSA-PSS，比 PKCS#1 v1.5 更安全 |

**注意**：证书的 `signatureAlgorithm` 与 `subjectPublicKeyInfo.algorithm` 是两回事。前者是 CA 签发本证书用的算法，后者是本证书中的公钥本身的算法。比如一张 ECDSA 证书可以由 RSA CA 签发。

### 3.4 签发者与主体（Issuer / Subject）

`issuer` 和 `subject` 都是 **DN（Distinguished Name，可分辨名称）**，结构为 SEQUENCE OF RDN（RDN = SET OF AttributeTypeAndValue）。常见的 DN 属性：

| OID | 短名 | 全名 | 说明 |
|-----|------|------|------|
| 2.5.4.3 | CN | commonName | 通用名（历史域名存放处） |
| 2.5.4.6 | C | countryName | 国家代码（2 字符） |
| 2.5.4.7 | L | localityName | 地区 |
| 2.5.4.8 | ST | stateOrProvinceName | 省/州 |
| 2.5.4.10 | O | organizationName | 组织 |
| 2.5.4.11 | OU | organizationalUnitName | 部门 |
| 1.2.840.113549.1.9.1 | emailAddress | emailAddress | 邮箱（已弃用于证书） |
| 0.9.2342.19200300.100.1.25 | DC | domainComponent | 域名组件（如 `example.com` 拆为 `DC=example, DC=com`） |

**RFC 2253 字符串表示**：倒序、逗号分隔，如 `CN=example.com, O=Example Inc, C=US`。

**自签证书**：subject == issuer。根 CA 都是自签的（subject == issuer，且用自己的私钥验证签名）。终端证书的 issuer 等于签发它的中间 CA 的 subject。

### 3.5 有效期（Validity）

```
Validity ::= SEQUENCE {
    notBefore   Time,
    notAfter    Time
}
Time ::= CHOICE {
    utcTime         UTCTime,         -- 1950-2049 年
    generalTime     GeneralizedTime  -- 1950 年前或 2050 年后
}
```

RFC 5280 规定：

- UTCTime 表示 1950-2049 年（2 位年份，>=50 视为 19xx，<50 视为 20xx）
- GeneralizedTime 表示 2050 年后或 1950 年前（4 位年份）

**为什么很多证书在 2025 年开始用 GeneralizedTime？** 因为 2050 年临近，CA 提前切换避免兼容性问题。Let's Encrypt 自 2024 年起对到期日期在 2050 年后的证书使用 GeneralizedTime。

**有效期校验**：

- 当前时间 < notBefore：未生效（usually 时钟不准）
- 当前时间 > notAfter：已过期
- 中间：有效

**运维建议**：剩余 < 30 天时启动续期，剩余 < 14 天时告警。

### 3.6 公钥信息（SubjectPublicKeyInfo）

```
SubjectPublicKeyInfo ::= SEQUENCE {
    algorithm       AlgorithmIdentifier,  -- 算法 + 参数
    subjectPublicKey BIT STRING             -- 公钥字节
}
```

**RSA 公钥**：BIT STRING 内部是 `RSAPublicKey ::= SEQUENCE { modulus INTEGER, publicExponent INTEGER }`。模数长度即密钥长度（如 2048 位 = 256 字节）。

**ECDSA 公钥**：AlgorithmIdentifier 的 parameters 是命名曲线 OID（如 P-256 = `1.2.840.10045.3.1.7`）。BIT STRING 直接是 EC 点（04 开头表示非压缩格式，后跟 X、Y 两个坐标）。

**EdDSA 公钥**：AlgorithmIdentifier 无 parameters，BIT STRING 直接是 32 字节（Ed25519）或 57 字节（Ed448）的公钥。

### 3.7 签名值（Signature Value）

CA 对 tbsCertificate（不含外层签名）做哈希后用自己的私钥签名，结果放在 `signatureValue`（BIT STRING）。

- RSA 签名：长度等于模数长度（如 2048 位 RSA = 256 字节签名）
- ECDSA 签名：DER 编码的 `ECDSA-Sig-Value ::= SEQUENCE { r INTEGER, s INTEGER }`，长度不固定（约 70-72 字节）
- EdDSA 签名：直接是 64 字节（Ed25519）或 114 字节（Ed448），无 DER 包装

## 四、扩展（Extensions）：v3 证书的关键能力

X.509 v3 通过 `extensions [3] EXPLICIT Extensions` 字段支持灵活的元信息扩展。每个扩展结构：

```asn1
Extension ::= SEQUENCE {
    extnID      OBJECT IDENTIFIER,
    critical    BOOLEAN DEFAULT FALSE,
    extnValue   OCTET STRING
}
```

`critical` 为 `TRUE` 时表示关键扩展，客户端必须识别并验证该扩展，否则拒绝证书。常见的 9 个核心扩展：

### 4.1 basicConstraints（基础约束）

OID: `2.5.29.19`，通常为关键扩展。

```asn1
BasicConstraints ::= SEQUENCE {
    cA                      BOOLEAN DEFAULT FALSE,
    pathLenConstraint       INTEGER (0..MAX) OPTIONAL
}
```

- `cA=TRUE`：本证书是 CA 证书，可签发下级证书
- `pathLenConstraint`：CA 路径长度限制，如 `pathLen=0` 表示该 CA 只能签发终端证书，不能签下级 CA

终端证书的 basicConstraints 为 `cA=FALSE`（或不含此扩展）。CA 证书必须 `cA=TRUE`。

### 4.2 keyUsage（密钥用途）

OID: `2.5.29.15`，BIT STRING 类型，每一位标识一个用途：

| 位 | 用途 |
|----|------|
| 0 | digitalSignature（数字签名，含证书签名） |
| 1 | nonRepudiation（不可抵赖） |
| 2 | keyEncipherment（密钥加密，RSA 密钥交换） |
| 3 | dataEncipherment（数据加密） |
| 4 | keyAgreement（密钥协商，ECDSA / DH） |
| 5 | keyCertSign（证书签名，仅 CA） |
| 6 | cRLSign（CRL 签名，仅 CA） |
| 7 | encipherOnly（仅加密，配合 keyAgreement） |
| 8 | decipherOnly（仅解密，配合 keyAgreement） |

CA 证书必须设置 `keyCertSign`，终端证书通常设置 `digitalSignature + keyEncipherment`（RSA）或 `digitalSignature + keyAgreement`（ECDSA）。

### 4.3 extKeyUsage（扩展密钥用途，EKU）

OID: `2.5.29.37`，SEQUENCE OF OID。常见值：

| OID | 名称 | 用途 |
|-----|------|------|
| 1.3.6.1.5.5.7.3.1 | serverAuth | HTTPS 服务器证书 |
| 1.3.6.1.5.5.7.3.2 | clientAuth | 客户端证书（双向 TLS） |
| 1.3.6.1.5.5.7.3.3 | codeSigning | 代码签名 |
| 1.3.6.1.5.5.7.3.4 | emailProtection | S/MIME 邮件 |
| 1.3.6.1.5.5.7.3.8 | timeStamping | 时间戳 |
| 1.3.6.1.5.5.7.3.9 | OCSPSigning | OCSP 响应签名 |

HTTPS 证书必须含 `serverAuth`。

### 4.4 subjectAltName（SAN，主体可选名称）

OID: `2.5.29.17`，**现代证书最关键的字段之一**。结构：

```asn1
SubjectAltName ::= GeneralNames
GeneralNames ::= SEQUENCE OF GeneralName
GeneralName ::= CHOICE {
    otherName                       [0] otherName,
    rfc822Name                      [1] IA5String,        -- email
    dNSName                         [2] IA5String,        -- 域名
    x400Address                     [3] ORAddress,
    directoryName                   [4] Name,
    ediPartyName                    [5] EDIPartyName,
    uniformResourceIdentifier       [6] IA5String,        -- URI
    iPAddress                       [7] OCTET STRING,     -- IP（4 或 16 字节）
    registeredID                    [8] OBJECT IDENTIFIER
}
```

**为什么 SAN 替代 CN？**

- 早期证书把域名放在 CN（如 `CN=example.com`），但 CN 只能放一个
- RFC 6125 明确要求客户端**优先校验 SAN**，CN 字段仅作向后兼容
- Chrome 自 2017 年起忽略 CN，仅校验 SAN
- Let's Encrypt 自 2015 年起签发的证书 CN 必须在 SAN 中重复出现
- 单张证书可通过 SAN 保护多个域名（如 `*.example.com + example.org + www.example.net`）

本工具将 SAN 拆分为 DNS / IP / URI / email 等类型单独展示。

### 4.5 subjectKeyIdentifier / authorityKeyIdentifier（SKI / AKI）

OID 分别为 `2.5.29.14` 和 `2.5.29.35`。

- **SKI**：本证书公钥的标识符（通常是公钥的 SHA-1 哈希前 20 字节）
- **AKI**：签发本证书的 CA 的 SKI（用于构造证书链）

证书链构造规则：终端证书的 AKI == 中间 CA 的 SKI，中间 CA 的 AKI == 根 CA 的 SKI。本工具同时展示两者，便于人工核对链路关系。

### 4.6 cRLDistributionPoints（CRL 分发点）

OID: `2.5.29.31`，提供 CRL 下载 URL。客户端可下载 CRL 检查证书是否被撤销。CRL 是 CA 定期发布的已撤销证书列表（通常每 24 小时更新一次）。

### 4.7 authorityInfoAccess（AIA）

OID: `1.3.6.1.5.5.7.1.1`，包含两类信息：

- **OCSP URL**：实时查询证书状态的端点（比 CRL 更轻量、更实时）
- **CA Issuers URL**：签发者证书的下载地址（用于补全证书链）

```
http://ocsp.int-x3.letsencrypt.org/      <- OCSP
http://cert.int-x3.letsencrypt.org/      <- CA Issuers
```

**实战**：如果服务器只发送了终端证书，浏览器会自动从 AIA 的 CA Issuers URL 下载中间证书补全链路。但这是性能损耗（额外 RTT），所以服务器配置应主动发送中间证书。

### 4.8 certificatePolicies（证书策略）

OID: `2.5.29.32`，声明证书类型：

- `2.23.140.1.1`：EV（Extended Validation）扩展验证证书
- `2.23.140.1.2.1`：DV（Domain Validation）域名验证证书
- `2.23.140.1.2.2`：IV（Individual Validation）个人验证证书
- `1.2.840.113549.1.9.16.2.14`：永久标识符（用于企业证书）

每个策略可附带 CPS（Certification Practice Statement）URL，说明 CA 的签发流程。

### 4.9 signedCertificateTimestampList（SCT，证书透明度）

OID: `1.3.6.1.4.1.11129.2.4.2`，包含 CA 在签发证书时提交到证书透明度日志获得的签名时间戳。

- **CT（Certificate Transparency）**：RFC 6962，要求 CA 公开所有签发的证书，防止 CA 私自签发未公开证书
- **Chrome 要求**：2025 年 1 月后新签发的证书必须含至少 3 个来自不同日志的 SCT，否则拒绝
- **日志服务器**：Google Argon / Cloudflare Nimbus / Let's Encrypt Oak 等

本工具识别 SCT 扩展并展示其字节长度（详细解析需处理内部 Merkle 树结构，超出本文范围）。

## 五、证书链与 PKI 信任体系

### 5.1 PKI 三层结构

```
                    [Root CA]   ← 自签，预置在操作系统信任库
                        |
                        ↓ 签发
                [Intermediate CA]  ← 由 Root CA 签发，负责签发终端证书
                        |
                        ↓ 签发
                  [Leaf Cert]   ← 服务器实际使用的证书
```

- **Root CA**：自签证书（subject == issuer），预置在操作系统/浏览器信任库中，私钥离线保管在硬件模块内
- **Intermediate CA**：由 Root CA 签发，负责日常签发终端证书。Let's Encrypt 当前活跃的中间 CA 有 R10、R11、E5、E6 等
- **Leaf Cert**：终端证书，由 Intermediate CA 签发，含具体域名（在 SAN 中）

### 5.2 证书链验证流程

客户端（浏览器）收到服务器发送的证书链后：

1. **找到终端证书**：链中 subject 与请求域名匹配的证书
2. **找到中间证书**：通过 AKI 匹配上一级 CA 的 SKI，递归向上找
3. **找到根证书**：链路终点是自签证书，且该证书在客户端信任库中
4. **校验签名**：每一级用上一级的公钥验证本级签名
5. **校验有效期**：所有证书都在有效期内
6. **校验撤销**：检查 CRL / OCSP，确认未被撤销
7. **校验用途**：basicConstraints.cA=true（仅 CA 证书）、keyUsage.keyCertSign（仅 CA）、EKU.serverAuth（终端证书）

### 5.3 常见配置错误

#### 错误 1：服务器只发送终端证书

```
浏览器发送 ClientHello
服务器发送 Certificate 消息（仅含 1 张终端证书）
浏览器报错：unable to get local issuer certificate / NET::ERR_CERT_AUTHORITY_INVALID
```

**修复**：将终端证书 + 中间证书合并为 fullchain.pem，配置在 Nginx `ssl_certificate`：

```nginx
ssl_certificate /etc/letsencrypt/live/example.com/fullchain.pem;
```

#### 错误 2：证书链顺序错误

证书链必须按 **终端证书在前、中间证书在后** 的顺序发送。如果顺序反了，部分客户端（如 OpenSSL 1.1.1 之前版本）会拒绝。

#### 错误 3：根证书也发送

根证书预置在客户端，无需服务器发送（发送了客户端也会忽略）。最佳实践是发送「终端 + 中间」，根证书不放服务器。

### 5.4 自签证书

自签证书（subject == issuer）有两种情况：

- **Root CA**：合法的自签证书，预置在信任库中
- **私有 CA / 测试证书**：自己生成的自签证书，未被公开信任

私有 CA 证书要被浏览器信任，需将证书导入到操作系统信任库：

- Windows：`certutil -addstore -f "ROOT" my-ca.pem`
- macOS：`sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain my-ca.pem`
- Linux：`sudo cp my-ca.pem /usr/local/share/ca-certificates/my-ca.crt && sudo update-ca-certificates`

## 六、撤销与透明度：CRL / OCSP / SCT

### 6.1 CRL（Certificate Revocation List）

CA 定期发布的已撤销证书列表（RFC 5280）。结构：

```
CertificateList ::= SEQUENCE {
    tbsCertList     TBSCertList,
    signatureAlgorithm AlgorithmIdentifier,
    signatureValue  BIT STRING
}

TBSCertList ::= SEQUENCE {
    version         Version OPTIONAL,  -- v2(1)
    signature       AlgorithmIdentifier,
    issuer          Name,
    thisUpdate      Time,
    nextUpdate      Time OPTIONAL,
    revokedCertificates SEQUENCE OF SEQUENCE {
        userCertificate  CertificateSerialNumber,  -- 序列号
        revocationDate   Time,
        crlEntryExtensions Extensions OPTIONAL
    } OPTIONAL,
    crlExtensions   [0] EXPLICIT Extensions OPTIONAL
}
```

**CRL 短板**：

- 文件大（一张 CRL 可能含数千万条记录，几 MB 到几十 MB）
- 更新延迟（通常 24 小时更新一次）
- 客户端下载有性能损耗

**CRL Reason**：撤销原因代码（如 1=keyCompromise 密钥泄露、3=affiliationChanged 从属关系变更、4=superseded 被替代、5=cessationOfOperation 业务停止）。

### 6.2 OCSP（Online Certificate Status Protocol）

实时查询某张证书是否被撤销（RFC 6960）。流程：

1. 客户端向 OCSP URL 发送 POST 请求，含证书序列号
2. CA 的 OCSP 响应服务器查询数据库，返回签名响应
3. 响应含状态：good（有效）/ revoked（已撤销）/ unknown（未知）

**优点**：实时、轻量（单次查询）。
**短板**：

- 性能损耗（每次 HTTPS 握手需额外 RTT 查 OCSP）
- 隐私问题（CA 知道客户端访问了哪些网站）
- 可用性风险（OCSP 服务器宕机时客户端行为不一致）

**OCSP Stapling**：服务器预先获取 OCSP 响应，在 TLS 握手时发送给客户端，解决上述问题。Nginx 配置：

```nginx
ssl_stapling on;
ssl_stapling_verify on;
ssl_trusted_certificate /etc/letsencrypt/live/example.com/chain.pem;
resolver 8.8.8.8;
```

### 6.3 SCT（Signed Certificate Timestamp，证书透明度）

RFC 6962 定义，CA 在签发证书时将签发记录提交到公开日志服务器，日志返回签名时间戳（SCT）嵌入证书扩展中。

**目的**：防止 CA 私自签发未公开证书。所有签发的证书都进入公开日志，任何人可查询、审计。

**Chrome CT 政策**：

- 2018：新签发证书必须含至少 1 个 SCT
- 2021：必须含至少 2 个来自不同日志的 SCT
- 2025：必须含至少 3 个来自不同日志的 SCT

**日志服务器**：Google Argon / Cloudflare Nimbus / Let's Encrypt Oak / DigiCert Yeti 等。每个日志服务器独立运营，由不同组织维护。

**查询**：访问 `https://crt.sh/?q=example.com` 可查看所有公开日志中签发给 example.com 的证书。

## 七、密钥算法选型与最佳实践

### 7.1 RSA vs ECDSA vs EdDSA

| 算法 | 密钥长度 | 签名速度 | 验证速度 | 兼容性 | 适用场景 |
|------|----------|----------|----------|--------|----------|
| RSA 2048 | 256 字节 | 慢 | 快 | 全部 | 兼容性要求高的老设备 |
| RSA 3072 | 384 字节 | 很慢 | 中等 | 全部 | 长期安全要求 |
| RSA 4096 | 512 字节 | 极慢 | 中等 | 全部 | 过度安全要求 |
| ECDSA P-256 | 64 字节 | 快 | 快 | 99%+ | 现代网站（推荐） |
| ECDSA P-384 | 96 字节 | 中等 | 快 | 99%+ | 高安全要求 |
| Ed25519 | 32 字节 | 极快 | 极快 | 95%+ | 高性能 + 高安全 |

**选型建议**：

- **新部署**：优先 ECDSA P-256（兼容性、性能、安全性均衡）
- **兼容老设备**（Android 7 以下、Windows XP）：RSA 2048
- **极致性能**（IoT、移动端）：Ed25519（需确认客户端支持）
- **避免**：RSA 1024（已禁用）、ECDSA secp256k1（仅区块链场景）

### 7.2 Let's Encrypt 实践

Let's Encrypt 支持的密钥算法：

- **RSA**：2048（默认）、3072、4096
- **ECDSA**：P-256、P-384（需使用 `--key-type ec` 参数）

申请 ECDSA 证书：

```bash
certbot certonly --webroot -w /var/www/html -d example.com \
  --key-type ec --elliptic-curve secp256r1
```

注意 ECDSA 证书必须配合 ECDSA 私钥使用，Nginx 配置无需改动。

### 7.3 证书监控清单

运维监控要点：

1. **剩余天数告警**：剩余 30 天提前续期，剩余 14 天告警
2. **证书链完整性**：定期用 `openssl s_client` 检查链路
3. **OCSP Stapling**：确保开启且响应有效
4. **CT 日志**：在 crt.sh 查询证书是否被记录
5. **SAN 域名变化**：新增域名后确认 SAN 包含
6. **签名算法**：避免 SHA-1（已禁用），使用 SHA-256 及以上
7. **密钥强度**：RSA >= 2048，ECDSA >= P-256

### 7.4 排查清单

遇到 HTTPS 证书问题时按以下顺序排查：

1. `openssl s_client -connect example.com:443 -servername example.com`：查看服务器发送的证书链
2. 检查链路是否完整（终端 + 中间，根证书不需要）
3. 检查终端证书有效期（`openssl x509 -in cert.pem -noout -dates`）
4. 检查 SAN 是否包含请求域名（`openssl x509 -in cert.pem -noout -text | grep -A 1 'Subject Alternative Name'`）
5. 检查 EKU 是否含 serverAuth
6. 检查 OCSP 是否可用（`openssl ocsp -issuer chain.pem -cert leaf.pem -url OCSP_URL -resp_text`）
7. 用本工具直接粘贴 PEM 查看全部字段

## 八、最佳实践与总结

### 8.1 证书配置最佳实践

1. **使用 Let's Encrypt 自动续期**：免费、自动化、广受信任
2. **配置完整证书链**：Nginx 使用 `fullchain.pem`，不要用 `cert.pem`
3. **启用 OCSP Stapling**：提升 TLS 握手性能、保护用户隐私
4. **使用 ECDSA P-256**：现代浏览器全部支持，性能与安全性最优
5. **配置 HSTS**：`Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`
6. **配置 modern cipher suite**：仅启用 AEAD 加密（AES-GCM、ChaCha20-Poly1305）
7. **TLS 1.2+ only**：禁用 TLS 1.0/1.1 与 SSLv3
8. **定期轮换私钥**：续期时同时轮换私钥，避免长期使用同一密钥

### 8.2 调试工具链对照

| 工具 | 命令 | 用途 |
|------|------|------|
| openssl | `openssl x509 -in cert.pem -text -noout` | 查看 PEM 证书全部字段 |
| openssl | `openssl s_client -connect host:443 -servername host` | 查看服务器证书链 |
| openssl | `openssl verify -CAfile chain.pem cert.pem` | 验证证书链 |
| openssl | `openssl ocsp -issuer chain.pem -cert cert.pem -url OCSP_URL` | 查询 OCSP 状态 |
| curl | `curl -vI https://example.com` | 查看 TLS 握手详情 |
| 本工具 | 粘贴 PEM | 在浏览器中查看证书结构 |

### 8.3 与本站工具矩阵协同

- **TLS 证书解析**（/tls）：本文主题，查看证书结构
- **DNS 查询**（/dns）：检查 HTTPS 记录、CAA 配置
- **HTTP Header 解析**（/http-headers）：查看 HSTS、CSP 等安全响应头
- **HTTP 状态码**（/http-status）：与证书错误对应的 HTTP 错误排查
- **HTTP 请求代码生成器**（/http-request）：生成 cURL 命令验证证书链
- **JWT 解码**（/jwt）：同属 ASN.1 编码体系，OID 与编码规则相通

### 8.4 总结

TLS 证书远不止「域名 + 公钥 + 签名」那么简单，它是 RFC 5280 定义的复杂 ASN.1 结构，承载着：

- **身份信息**：版本、序列号、签发者、主体、有效期
- **加密能力**：公钥算法、密钥长度、曲线参数
- **扩展能力**：SAN、EKU、basicConstraints、AKI/SKI
- **撤销机制**：CRL 分发点、OCSP、AIA
- **透明度保证**：SCT

理解这些字段后，再看到 `NET::ERR_CERT_AUTHORITY_INVALID` 或 `unable to get local issuer certificate` 时，你能立刻定位是证书链缺失还是 CA 不被信任；看到 `CERT_DATE_INVALID` 时，能想到是时钟不准还是证书真的过期；看到证书 SAN 时，能确认通配符是否覆盖当前子域名。

本工具的目标是让这些底层结构可视化、可查询、可分享。下次配置 HTTPS 证书时，把 PEM 粘贴进来对比字段，比对照 RFC 5280 文档快 10 倍。
