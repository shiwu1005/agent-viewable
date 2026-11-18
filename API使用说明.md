# Aholo Lux3D API 使用说明

记录本项目实际调用的接口、参数、返回结构，以及踩过的坑。

---

## 一、接入信息

| 项 | 值 |
|---|---|
| 网关（海外） | `https://api.aholo.ai/global` |
| 网关（国内） | `https://api.aholo3d.cn` |
| 鉴权 | 请求头 `authorization: <API_KEY>` |
| 请求头 | `content-type: application/json` |
| 统一响应 | `{ c, f, m, d }` |

**判断成功只看 `c`**：

```
c === "0"   成功，数据在 d
c !== "0"   失败，原因在 m
```

> 国内网关在开发期间无法访问，实际全程使用海外网关。

---

## 二、文生 3D（text-to-3D）

### 2.1 提交任务

```
POST /lux3d/v1/generate/text-to-3d/task/create
```

```json
{
  "prompt": "A reception counter desk, solid warm wooden front panel with a wide flat top surface, waist high, front facing view, single object, clean product shot, plain background",
  "style": "cartoon",
  "version": "G1",
  "faceCount": 40000,
  "outputFormat": ["glb"],
  "aiPredictSize": true
}
```

返回：

```json
{ "c": "0", "d": 8012283 }
```

`d` 就是 `taskId`。

### 2.2 参数说明

| 参数 | 取值 | 说明 |
|---|---|---|
| `prompt` | 文本 | 英文效果更稳；单物体、正面视角、纯背景 |
| `style` | 见下表 | 全项目统一用 `cartoon` |
| `version` | `G1` | 当前可用版本 |
| `faceCount` | 20000 / 40000 | 家具 4 万面，小物件 2 万面 |
| `outputFormat` | `["glb"]` | 只要 GLB |
| `aiPredictSize` | `true` | 生成时自动推定真实尺寸，避免大小离谱 |

**可用风格**：

```
photorealistic  cartoon  anime  hand_painted  cyberpunk  fantasy  glass
```

> 传 `realistic` 会报错，必须用 `photorealistic`。

### 2.3 轮询

```
GET /lux3d/v1/generate/task/get?taskid=<taskId>
```

返回 `d.status`：

| status | 含义 |
|---|---|
| 0 | 排队 |
| 1 | 运行中 |
| 3 | 完成 |
| 4 | 失败 |
| 6 | 取消 |

完成后 `d.outputs[]` 里挑 `content` 以 `.glb` 结尾的那个就是模型地址，直接下载。

**实测耗时**：单件 3–10 分钟，取决于排队。
**并发**：建议 2 路并发，再多容易失败。

---

## 三、动作重定向（retarget）

把动作库的片段绑到生成的角色骨骼上。

### 3.1 提交

```
POST /lux3d/v1/animations/retarget/task/create
```

```json
{
  "rigModelUrl": "https://<角色 glb 地址>",
  "animationIds": ["Idle_Loop", "Walk_Formal_Loop", "Interact"],
  "animationOutputMode": "combined",
  "outFormat": "glb"
}
```

### 3.2 关键限制

- **一次最多 10 个 `animationIds`**
- **整批校验**：只要有一个 ID 不存在，整个任务返回
  `c=-1 unknown animation_id: XXX`，一个都不会产出

所以我们用「探针脚本 + 二分」的办法逐步试出可用 ID。

### 3.3 已验证可用的 13 个动作 ID

```
Idle_Loop              Walk_Formal_Loop      Interact
Idle_FoldArms_Loop     Fixing_Kneeling       Walk_Carry_Loop
Sitting_Idle_Loop      OverhandThrow         Push_Loop
PickUp_Table           Idle_Talking_Loop     Chest_Open
Interact2
```

> 官方没有公开完整动作列表，`/lux3d/v1/animations/list`、`/presets` 等路径均返回 404。

### 3.4 取结果

任务完成后 `outputs[0].content` 是一段 **JSON 字符串**：

```json
{ "actions": [ { "animation_id": "Interact", "status": 3, "animationGlbUrl": "https://..." } ] }
```

按 `animation_id` 逐个下载，或直接下 `combined` 合并版。

---

## 四、项目里实际生成了什么

| 资产 | 文件 | 面数 | 用途 |
|---|---|---|---|
| 人物 | `worker.glb` | 4 万 | 四个房间的工人 |
| 人物动作 | `worker-moves.glb` | — | 13 个重定向动作 |
| 接待台 | `counter.glb` | 4 万 | ① 接单 |
| 白板 | `whiteboard.glb` | 4 万 | ② 思考 |
| 站立桌 | `standingdesk.glb` | 4 万 | ③ 执行 |
| 投递箱 | `dropbox.glb` | 4 万 | ④ 交付 |
| 办公桌 / 椅子 / 显示器 | `desk*.glb` | 4 万 | 备用 |
| 绿植 / 杯子 / 书堆 / 书架 | 若干 | 2 万 | 场景点缀 |

---

## 五、工程上的坑

### 5.1 生成模型尺寸不可控

`aiPredictSize: true` 只是"推定"，同一提示词两次生成的模型大小可能差一倍。

**解决**：全部在运行时归一化——加载后量包围盒，按目标高度缩放、脚踩地、XZ 居中。

### 5.2 生成模型朝向不统一

有的朝 +Z，有的朝 -Z。**解决**：摆进场景后按视觉调整 yaw，不依赖 API 保证。

### 5.3 家具之间会错位

桌子和显示器分开生成时，屏幕总会悬空或陷进桌面几厘米。

**解决**：运行时测量。加载桌子后取包围盒，把显示器底面放到 `box.max.y`，键盘放到桌深 72% 处。换任何桌子模型都不会错位。

### 5.4 动作片段没有"打字"

13 个动作里没有打字专用动作。**解决**：

- 用 `Interact` 当基础姿势
- 自写两段骨骼 CCD（上臂 + 前臂）把双手拉到键盘目标点
- 目标点做低通平滑，再加正弦微抖，看起来像在敲

### 5.5 逐帧录制

录制演示视频时禁用实时源，用固定时间戳喂事件，`frameloop="never"` + 手动 `step()`，
保证同样的输入产出完全相同的帧序列。

---

## 六、一句话总结

Lux3D 提供的是**资产**（模型 + 动作），
真正让场景成立的是**运行时对齐**：量包围盒、归一化、按实测值摆放。

生成的模型不需要"一次就完美"，只要能在运行时被测量和校正。
