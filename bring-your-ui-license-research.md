# 当前仓库的 Bring Your UI 许可证调研

## 结论

`bringYourUi` 是经签名验证的许可证权益，不是数据库布尔开关。可以在数据库保存由当前构建信任的签发方签名的许可证，但仅增加 `bringYourUi: true` 或修改 JWT payload 不会获得权益。建议使用控制台安装入口或 `PUT /api/systems/license`，而不是直接修改数据库。

## 存储和校验

- 全局 `systems` 表保存许可证；`license` 值结构为 `{ jwt, installedAt }`，不是单独的 `bringYourUi` 行。来源：[schema](packages/schemas/src/types/system.ts)、[table](packages/schemas/tables/systems.sql)。
- `verifyLicenseKey` 使用 `jose.compactVerify` 和 `EdDSA` 验证签名，然后验证 payload schema；篡改 payload 会使签名无效。来源：[verify.ts:45–69](packages/core/src/license/verify.ts#L45)。
- 受信任的公钥由构建提供，生产环境不接受用于开发的公钥覆盖。来源：[public-key.ts](packages/core/src/license/public-key.ts)。
- `LicenseReader` 以进程为单位缓存 60 秒；读取失败回退到默认权益。当前自部署 plans 尚受 `isDevFeaturesEnabled` 保护，关闭时忽略已安装许可证。来源：[LicenseReader.ts:43–52](packages/core/src/license/LicenseReader.ts#L43)、[134–142](packages/core/src/license/LicenseReader.ts#L134)。
- 默认 `bringYourUi` 为 false，最终权益从已验证 payload 解析。来源：[license.ts](packages/schemas/src/consts/license.ts)。

## 支持的安装入口

- 控制台 License 页面调用 `PUT /api/systems/license`。来源：[use-install-license.ts](packages/console/src/pages/OssTenantSettings/License/use-install-license.ts)。
- API 安装时验证签名和 payload，检查有效期，保存状态并失效当前进程缓存；当前入口同样受 dev feature 保护。来源：[system.ts](packages/core/src/routes/system.ts)。
- 通用 `logto database system set` CLI 可以写入系统配置，但结构校验不替代读取时的签名验证。来源：[database/system.ts](packages/cli/src/commands/database/system.ts)。

## Custom UI 的额外前提及边界

- 自部署上传接口检查许可证的 `bringYourUi`，还需要 `experienceBlobsProviderConfig` 资源存储配置；许可证本身不会配置存储。来源：[custom-ui-assets/index.ts](packages/core/src/routes/sign-in-experience/custom-ui-assets/index.ts)。
- 许可证与已经配置的 UI 资源不是同一数据：`sign_in_experiences.custom_ui_assets` 保存资源引用。来源：[sign_in_experiences.sql](packages/schemas/tables/sign_in_experiences.sql)。
- 当前运行时 `koaSpaProxy` 在该引用存在时选择自定义 UI，没有在此重新校验许可证；资源服务仍要求正确存储配置。因此不能声称所有直接数据库修改都会被运行时许可证检查阻止。这不等于写入了合法许可证，也不是支持的安装方式。来源：[koa-spa-proxy.ts:57–61](packages/core/src/middleware/koa-spa-proxy.ts#L57)、[koa-serve-custom-ui-assets.ts](packages/core/src/middleware/koa-serve-custom-ui-assets.ts)。

## 验证范围

只读源码调查；未修改数据库、许可证或运行配置。使用当前 core 依赖的 `jose` 做一次性签名 smoke：临时 EdDSA 密钥签发原始 payload 后验签成功，将 `bringYourUi` 从 false 改成 true 且保留签名后得到 `ERR_JWS_SIGNATURE_VERIFICATION_FAILED`。此验证证明验签原语拒绝篡改，不是正式许可证安装或端到端 Custom UI 验证。
