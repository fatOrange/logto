# WeChat MP (service account) QR code connector

The official Logto connector for WeChat service account (服务号) QR code sign-in in web apps.

微信服务号扫码登录官方 Logto 连接器 [中文文档](#微信服务号扫码登录连接器)

**Table of contents**

- [WeChat MP (service account) QR code connector](#wechat-mp-service-account-qr-code-connector)
  - [How it works](#how-it-works)
  - [Prerequisites](#prerequisites)
  - [Configure your WeChat service account](#configure-your-wechat-service-account)
    - [Enable the QR code permission](#enable-the-qr-code-permission)
    - [Configure the message push server](#configure-the-message-push-server)
  - [Configure the connector in Logto](#configure-the-connector-in-logto)
  - [Enable the connector in the sign-in experience](#enable-the-connector-in-the-sign-in-experience)
  - [Security notes](#security-notes)
- [微信服务号扫码登录连接器](#微信服务号扫码登录连接器)
  - [工作原理](#工作原理)
  - [前置条件](#前置条件)
  - [配置你的微信服务号](#配置你的微信服务号)
    - [开通带参数的二维码权限](#开通带参数的二维码权限)
    - [配置消息推送服务器](#配置消息推送服务器)
  - [在 Logto 中配置连接器](#在-logto-中配置连接器)
  - [在登录体验中启用连接器](#在登录体验中启用连接器)
  - [安全注意事项](#安全注意事项)

## How it works

This connector does **not** redirect users to WeChat. Instead, Logto renders a QR code in
the sign-in page:

1. When the user clicks the WeChat sign-in button, Logto creates a **parameterized QR
   code** via the WeChat API (`POST /cgi-bin/qrcode/create`, temporary string scene QR
   code) with a random one-time scene value, valid for 300 seconds.
2. The user scans the QR code with WeChat. If the user has not followed the service
   account yet, they are prompted to follow it first; both cases work.
3. WeChat pushes a `SCAN` or `subscribe` event (with the scene value) to the callback URL
   configured in the WeChat service account server settings.
4. Logto matches the scene value against the pending sign-in session and signs the user
   in on the browser that created the QR code. No confirmation on the phone is needed.

Scanning verifies the WeChat identity; existing Logto registration, required-profile,
and MFA policies still apply.

The QR code is valid for 300 seconds. After it expires, use the manual refresh button to
create a new one.

## Prerequisites

- A **verified** WeChat service account (微信认证服务号). Personal subscriptions do not
  qualify. Sign up at https://mp.weixin.qq.com/.
- The **带参数的二维码** (parameterized QR code) permission, which requires a verified
  service account.
- A publicly reachable HTTPS endpoint for the callback URL (see below).
- This connector is a **development feature**. It is exposed automatically in
  development, but in production builds you must enable it by setting the
  `DEV_FEATURES_ENABLED` environment variable on your Logto instance.

## Configure your WeChat service account

### Enable the QR code permission

The parameterized QR code API is available to verified service accounts out of the box.
If the API returns error code `61004` ("access denied by api"), contact WeChat support to
enable the `生成带参数的二维码` permission for your account.

If your server IP addresses are fixed, add them to the **IP allowlist** (IP 白名单) in the
WeChat official account settings (设置与开发 → 基本配置 → IP白名单). Requests from
non-allowlisted IPs receive error code `40164`.

### Configure the message push server

1. In the WeChat official account admin console, go to 设置与开发 → 基本配置 →
   服务器配置 and click 修改配置.
2. Fill in:
   - **URL**: `https://<your-logto-domain>/api/authn/qr-code/<connector-id>` — the public
     QR code callback endpoint of your Logto instance (the connector ID is shown when you
     create the connector in Logto).
   - **Token**: any string you choose; fill the same value in the connector config below.
   - **EncodingAESKey**: click 随机生成 to generate one; fill the same value in the
     connector config below.
   - **消息加解密方式** (message encryption mode): choose **安全模式** (safe mode,
     recommended). Plain mode (明文模式) is supported but not recommended.
3. Submit. WeChat performs a signature verification challenge against the URL; Logto
   answers it automatically once the connector is configured and enabled.

> **⚠️ Caution**
>
> Once the message push server is enabled, auto replies and custom menus configured in
> the WeChat admin console stop working, because those messages are forwarded to the
> callback URL instead. Custom menus created via the WeChat API are not affected. Do not
> reuse the same service account for other callback-driven integrations.

## Configure the connector in Logto

1. Add the **WeChat (MP)** connector in the Logto console.
2. Fill in:
   - **App ID**: the service account's `appId` (AppID), from 设置与开发 → 基本配置.
   - **App Secret**: the service account's `appSecret` (AppSecret).
   - **Token**: the callback Token from the server configuration above. This is **not**
     the App Secret.
   - **Encryption mode**: must match the 消息加解密方式 selected in the WeChat server
     configuration exactly. Use **Safe**.
   - **Encoding AES Key**: the EncodingAESKey from the server configuration above;
     required in safe mode.
3. Save and enable the connector.

## Enable the connector in the sign-in experience

That's it. Don't forget to [enable the connector in the sign-in
experience](https://docs.logto.io/docs/tutorials/get-started/enable-social-sign-in).

> **⚠️ Caution**
>
> This connector only supports QR code sign-in (scan-to-sign-in). The standard redirect
> flow (`getAuthorizationUri`) is intentionally not implemented: opening the WeChat
> authorization page from a desktop browser cannot complete a service account sign-in
> without a scan. The connector appears as a button that opens an inline QR panel in the
> sign-in page, and is hidden on mobile devices.

## Security notes

- The callback `Token` (signature) and `EncodingAESKey` (payload encryption) are distinct
  from the `App Secret` used to call WeChat APIs. All three are secrets; do not expose
  them.
- Safe mode (recommended) encrypts all pushed messages with AES-256-CBC and validates the
  decrypted payload's trailing `appId` against the configured App ID, so encrypted
  payloads issued for a different app are rejected.
- All callback signatures are verified in a timing-safe manner; requests with invalid
  signatures, invalid encryption, duplicate or tampered XML fields, or XML entities/DTD
  constructs are rejected and never acknowledged.
- The sign-in identity is `${appId}:${openid}`, scoped to the `wechat-mp` connector
  target. No WeChat profile (nickname, avatar) is fetched, and no unionid lookup is
  performed.

# 微信服务号扫码登录连接器

## 工作原理

本连接器**不会**重定向用户到微信，而是在登录页内嵌展示二维码：

1. 用户点击微信登录按钮时，Logto 通过微信接口（`POST /cgi-bin/qrcode/create`，临时字符串场景值二维码）创建一个**带参数的二维码**，场景值为随机一次性字符串，有效期 300 秒。
2. 用户使用微信扫描二维码。若用户尚未关注服务号，会先引导关注；两种情况均受支持。
3. 微信将携带场景值的 `SCAN` 或 `subscribe` 事件推送到服务号服务器配置中填写的回调 URL。
4. Logto 将场景值与待登录会话匹配，并在创建二维码的浏览器上完成登录。手机端无需额外的登录确认操作。

扫码完成微信身份验证，后续仍遵循 Logto 现有的注册、必填用户资料和 MFA 策略。

二维码有效期 300 秒，过期后请使用手动刷新按钮重新生成。

## 前置条件

- **已认证**的微信服务号（个人订阅号不符合条件）。注册地址：https://mp.weixin.qq.com/。
- **带参数的二维码**接口权限（需要已认证的服务号）。
- 可公网访问的 HTTPS 回调地址（见下文）。
- 本连接器为**开发特性**。开发环境下会自动开放；生产环境需在 Logto 实例上设置 `DEV_FEATURES_ENABLED` 环境变量后方可使用。

## 配置你的微信服务号

### 开通带参数的二维码权限

已认证服务号默认可用该接口。若接口返回错误码 `61004`（access denied by api），请联系微信客服开通 `生成带参数的二维码` 权限。

若你的服务器 IP 固定，请在服务号后台（设置与开发 → 基本配置 → IP白名单）添加 IP 白名单。非白名单 IP 的请求会收到错误码 `40164`。

### 配置消息推送服务器

1. 在微信公众平台管理后台，进入 设置与开发 → 基本配置 → 服务器配置，点击 修改配置。
2. 填写：
   - **URL**：`https://<你的logto域名>/api/authn/qr-code/<connector-id>`，即你的 Logto 实例的公开二维码回调地址（连接器 ID 在 Logto 中创建连接器时显示）。
   - **Token**：任意字符串，需与下方连接器配置中的值一致。
   - **EncodingAESKey**：点击 随机生成，需与下方连接器配置中的值一致。
   - **消息加解密方式**：选择 **安全模式**（推荐）。也支持明文模式，但不推荐。
3. 提交。微信会对 URL 发起签名验证请求；连接器配置并启用后，Logto 会自动应答。

> **⚠️ 注意**
>
> 启用消息推送服务器后，微信公众平台中配置的自动回复和自定义菜单将失效，因为这些消息会转发到回调地址。通过微信接口创建的自定义菜单不受影响。请勿将同一服务号同时用于其他依赖回调的集成。

## 在 Logto 中配置连接器

1. 在 Logto 控制台中添加 **微信（服务号）** 连接器。
2. 填写：
   - **App ID**：服务号的 `appId`（AppID），见 设置与开发 → 基本配置。
   - **App Secret**：服务号的 `appSecret`（AppSecret）。
   - **Token**：上述服务器配置中的回调 Token。它**不是** App Secret。
   - **加密模式**：必须与微信服务器配置中选择的消息加解密方式完全一致。请使用**安全模式**。
   - **Encoding AES Key**：上述服务器配置中的 EncodingAESKey；安全模式下必填。
3. 保存并启用连接器。

## 在登录体验中启用连接器

大功告成。别忘了 [在登录体验中启用本连接器](https://docs.logto.io/zh-cn/docs/tutorials/get-started/enable-social-sign-in)。

> **⚠️ 注意**
>
> 本连接器仅支持扫码登录。标准重定向流程（`getAuthorizationUri`）为有意不实现：在桌面浏览器中打开微信授权页无法在不扫码的情况下完成服务号登录。连接器在登录页显示为按钮，点击后展示内嵌二维码面板，且在移动端设备上自动隐藏。

## 安全注意事项

- 回调 `Token`（签名）与 `EncodingAESKey`（消息加密）是两个不同的密钥，均区别于调用微信接口所用的 `App Secret`。三者皆为机密信息，请勿泄露。
- 安全模式（推荐）使用 AES-256-CBC 加密所有推送消息，并校验解密后报文尾部 `appId` 与配置的 App ID 一致，因此其他应用签发的加密报文会被拒绝。
- 所有回调签名均以恒定时间方式校验；签名无效、解密失败、XML 字段重复或被篡改、含 XML 实体/DTD 的请求都会被拒绝且不会应答。
- 登录身份为 `${appId}:${openid}`，归属于 `wechat-mp` 连接器目标。不获取微信资料（昵称、头像），也不进行 unionid 关联查询。
