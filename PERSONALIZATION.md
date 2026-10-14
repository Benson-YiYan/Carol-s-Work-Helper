# 个性化设置开发约定

本仓库的所有个性化设置（包括以后新增的设置）必须通过
`accountPreferences()` 读取、`saveAccountPreferences({设置项: 值})` 保存。
不要为新设置单独使用 localStorage；不要发送整份旧设置覆盖云端。
`LCBPersonalization.normalize` 必须保留未知设置项，已知项各自校验。

本网站仅使用 Supabase 项目 `fnkgulfdcljwjkcqibxi`。
读取 RPC：`carol_get_user_preferences`；保存 RPC：`carol_patch_user_preferences`。
后端通过 `lcb_app_user_id()` 获取当前身份，不接受客户端指定存储账户。
同名账户在另一网站仍属于另一项目，不能共用设置或调用另一站的函数。
新增设置需补充账号隔离、跨设备保存与旧字段保留测试。
