from __future__ import annotations

from pathlib import Path
from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parent
ASSET = ROOT / "assets"
OUT = ROOT / "image-slides-cn"
OUT.mkdir(parents=True, exist_ok=True)

W, H = 1600, 900
FONT_REG = "/System/Library/Fonts/STHeiti Light.ttc"
FONT_BOLD = "/System/Library/Fonts/STHeiti Medium.ttc"


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(FONT_BOLD if bold else FONT_REG, size)


F = {
    "kicker": font(22, True),
    "title": font(44, True),
    "sub": font(24),
    "h2": font(28, True),
    "body": font(20),
    "small": font(16),
    "tiny": font(13),
    "matrix": font(15),
    "matrix_b": font(15, True),
}

C = {
    "bg": "#F7F8FA",
    "ink": "#111827",
    "muted": "#667085",
    "line": "#D9DEE7",
    "panel": "#FFFFFF",
    "teal": "#0F8B8D",
    "teal_dark": "#0B5F62",
    "blue": "#2563EB",
    "amber": "#D9861C",
    "violet": "#6D5BD0",
    "soft_teal": "#E6F4F3",
    "soft_blue": "#EAF1FF",
    "soft_amber": "#FFF2DD",
    "soft_gray": "#EEF1F5",
    "red": "#C2410C",
}


def text_size(draw: ImageDraw.ImageDraw, text: str, fnt: ImageFont.FreeTypeFont) -> tuple[int, int]:
    box = draw.textbbox((0, 0), text, font=fnt)
    return box[2] - box[0], box[3] - box[1]


def wrap(draw: ImageDraw.ImageDraw, text: str, fnt: ImageFont.FreeTypeFont, max_w: int) -> list[str]:
    lines: list[str] = []
    for para in text.split("\n"):
        cur = ""
        for ch in para:
            test = cur + ch
            if draw.textlength(test, font=fnt) <= max_w or not cur:
                cur = test
            else:
                lines.append(cur)
                cur = ch
        if cur:
            lines.append(cur)
    return lines


def draw_wrapped(draw: ImageDraw.ImageDraw, xy: tuple[int, int], text: str, fnt, fill, max_w: int, line_gap=8):
    x, y = xy
    for line in wrap(draw, text, fnt, max_w):
        draw.text((x, y), line, font=fnt, fill=fill)
        _, h = text_size(draw, line, fnt)
        y += h + line_gap
    return y


def rounded(draw, box, fill, outline=None, width=1, r=18):
    draw.rounded_rectangle(box, radius=r, fill=fill, outline=outline, width=width)


def paste_contain(base: Image.Image, path: Path, box: tuple[int, int, int, int], alpha=1.0):
    img = Image.open(path).convert("RGBA")
    x, y, w, h = box
    img.thumbnail((w, h), Image.Resampling.LANCZOS)
    layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    layer.alpha_composite(img, ((w - img.width) // 2, (h - img.height) // 2))
    if alpha < 1:
        a = layer.getchannel("A").point(lambda p: int(p * alpha))
        layer.putalpha(a)
    base.alpha_composite(layer, (x, y))


def base():
    im = Image.new("RGBA", (W, H), C["bg"])
    draw = ImageDraw.Draw(im)
    return im, draw


def header(draw, kicker, title, sub):
    draw.text((64, 44), kicker, font=F["kicker"], fill=C["teal_dark"])
    draw_wrapped(draw, (64, 84), title, F["title"], C["ink"], 920, 10)
    draw_wrapped(draw, (66, 204), sub, F["sub"], C["muted"], 760, 8)


def card(draw, x, y, w, h, title, body, accent=C["teal"]):
    rounded(draw, (x, y, x + w, y + h), C["panel"], C["line"], 1, 14)
    draw.rounded_rectangle((x, y, x + 7, y + h), radius=5, fill=accent)
    draw.text((x + 28, y + 20), title, font=F["h2"], fill=C["ink"])
    draw_wrapped(draw, (x + 28, y + 60), body, F["body"], C["muted"], w - 56, 7)


def pill(draw, x, y, text, fill, stroke, color):
    tw, th = text_size(draw, text, F["small"])
    rounded(draw, (x, y, x + tw + 34, y + 36), fill, stroke, 2, 18)
    draw.text((x + 17, y + 9), text, font=F["small"], fill=color)
    return x + tw + 48


def slide1():
    im, d = base()
    paste_contain(im, ASSET / "01-runtime-overview.png", (842, 135, 660, 580))
    header(d, "01 / 产品定位", "EnterpriseAgent：垂类企业智能体平台", "把通用 Agent 能力产品化为企业可交付平台：渠道接入、上下文、工具治理、生成式 UI、长期记忆与自演化。")
    card(d, 64, 310, 680, 104, "不是聊天机器人，是端到端 Runtime", "首个验证场景是汽车 4S 店；真正资产是可复用架构：Router、Tool Governance、A2UI、Memory、DomainPack。", C["teal"])
    card(d, 64, 446, 680, 88, "客户价值", "不用先做 6 个月二次工程化：企业 IM、权限、工作流、审计和私有部署边界已内建。", C["blue"])
    card(d, 64, 566, 680, 88, "投资人价值", "从一个垂类打透，再复制到门店 + 导购 + CRM + 售后流程结构相似的多个行业。", C["amber"])
    x = 64
    x = pill(d, x, 704, "拿来即用", C["soft_teal"], "#B9DFDD", C["teal_dark"])
    x = pill(d, x, 704, "企业可上线", C["soft_blue"], "#BBD1FF", C["blue"])
    pill(d, x, 704, "垂类可复制", C["soft_amber"], "#F0C987", "#8A4B00")
    return im


def slide2():
    im, d = base()
    paste_contain(im, ASSET / "02-positioning.png", (818, 140, 672, 514))
    header(d, "02 / 竞品定位", "对手是横向工具，我们是垂类交付平台", "GBrain、OpenClaw、Claude Code、Hermes 分别强在记忆、个人助手、编码、自学习；我们把这些能力组合进企业场景。")
    rows = [
        ("GBrain", "个人/团队记忆大脑", "强在知识图谱与检索，不是完整 Agent。"),
        ("OpenClaw", "个人多渠道 AI 助手", "强在跨 IM 和本地优先，偏个人助手。"),
        ("Claude Code", "开发者终端编码助手", "强在代码场景，不覆盖业务流程。"),
        ("Hermes Agent", "个人自学习 Agent", "强在 self-improving loop，偏通用学习。"),
    ]
    rounded(d, (64, 306, 734, 652), C["panel"], C["line"], 1, 16)
    y = 334
    for name, pos, note in rows:
        d.text((94, y), name, font=F["h2"], fill=C["ink"])
        d.text((300, y + 4), pos, font=F["body"], fill=C["teal_dark"])
        d.text((94, y + 40), note, font=F["small"], fill=C["muted"])
        y += 78
        if y < 646:
            d.line((94, y - 15, 704, y - 15), fill=C["line"], width=1)
    rounded(d, (64, 686, 734, 780), C["soft_teal"], "#B9DFDD", 2, 16)
    draw_wrapped(d, (94, 710), "关键差异：我们不是再做一个通用助手，而是把 Runtime、记忆、渠道、自演化和企业权限包装成可交付产品。", F["body"], C["teal_dark"], 600, 8)
    return im


def slide3():
    im, d = base()
    header(d, "03 / 能力矩阵", "核心卖点是“能力合集 + 企业化封装”", "单点能力有人更强，但很少有产品同时具备 Runtime、企业治理、垂类工作流、生成式 UI 与自演化。")
    cols = [260, 188, 132, 142, 150, 126]
    heads = ["能力", "EnterpriseAgent", "GBrain", "OpenClaw", "Claude Code", "Hermes"]
    rows = [
        ["Agent runtime", "完整", "仅记忆层", "完整", "编码场景", "完整"],
        ["多租户/企业权限", "business_id 隔离", "团队偏弱", "单用户", "单开发者", "单用户"],
        ["企业 IM 渠道", "6 渠道适配", "无", "海外为主", "无", "海外为主"],
        ["垂类工具/工作流", "DomainPack", "无", "无", "无", "无"],
        ["长期记忆 + 图谱", "memory-service", "强项", "弱", "弱", "中"],
        ["Plan Mode / 门禁", "三级策略", "N/A", "沙箱", "强", "中"],
        ["A2UI 流式 UI", "6 Surface", "无", "Live Canvas", "无", "无"],
        ["私有化部署", "企业私有化", "自托管", "本地", "本地 CLI", "VPS"],
    ]
    x0, y0 = 64, 288
    x = x0
    for i, h in enumerate(heads):
        fill = C["teal_dark"] if i == 1 else "#E8ECF2"
        d.rectangle((x, y0, x + cols[i], y0 + 42), fill=fill, outline=C["line"])
        tw = d.textlength(h, font=F["matrix_b"])
        d.text((x + (cols[i] - tw) / 2, y0 + 13), h, font=F["matrix_b"], fill="white" if i == 1 else C["ink"])
        x += cols[i]
    for r, row in enumerate(rows):
        y = y0 + 42 + r * 48
        x = x0
        for c, val in enumerate(row):
            fill = "#F3F5F8" if c == 0 else C["soft_teal"] if c == 1 else C["panel"]
            d.rectangle((x, y, x + cols[c], y + 48), fill=fill, outline=C["line"])
            shown = ("✓ " + val) if c == 1 else val
            f = F["matrix_b"] if c in (0, 1) else F["matrix"]
            color = C["teal_dark"] if c == 1 else C["ink"] if c == 0 else C["muted"]
            lines = wrap(d, shown, f, cols[c] - 18)[:2]
            yy = y + 13 if len(lines) == 1 else y + 7
            for line in lines:
                tw = d.textlength(line, font=f)
                d.text((x + (cols[c] - tw) / 2 if c else x + 12, yy), line, font=f, fill=color)
                yy += 18
            x += cols[c]
    paste_contain(im, ASSET / "03-matrix.png", (1230, 270, 250, 250), 0.78)
    rounded(d, (940, 704, 1458, 792), C["panel"], C["line"], 1, 16)
    draw_wrapped(d, (972, 728), "结论：我们的优势不是单项跑分，而是把四类能力工程化为企业可上线的闭环。", F["body"], C["ink"], 456, 8)
    return im


def slide4():
    im, d = base()
    paste_contain(im, ASSET / "04-governance.png", (790, 145, 690, 530))
    header(d, "04 / 企业级落地", "从 Demo 到生产，关键是治理与接入", "B 端不是“能回答”就够了，还要身份、权限、审计、私有化、故障恢复，以及企业 IM 和工作流入口。")
    items = [
        ("统一入口", "Web / 企微 / 飞书 / 钉钉 / Webhook / Cron 统一进入 Query Engine", C["blue"]),
        ("权限门禁", "Tool Governance：权限检查、确认动作、timeout、retry、输出校验", C["teal"]),
        ("租户隔离", "business_id / tenant namespace，避免跨租户记忆、surface 与工具结果混用", C["amber"]),
        ("运维闭环", "health / ready / metrics / token 轮换 / 备份恢复 / 离线队列", C["violet"]),
    ]
    for i, (t, b, a) in enumerate(items):
        card(d, 64, 300 + i * 96, 640, 74, t, b, a)
    rounded(d, (64, 704, 704, 786), C["soft_amber"], "#EECF9A", 2, 16)
    draw_wrapped(d, (94, 728), "客户卖点：企业不需要先把通用 Agent 二次工程化，平台已经把安全、接入、权限和运维边界放进 Runtime。", F["body"], "#7A4A00", 570, 8)
    return im


def slide5():
    im, d = base()
    paste_contain(im, ASSET / "05-evolution.png", (790, 150, 690, 510))
    header(d, "05 / 自演化与复制路径", "越用越懂业务，最终沉淀成可复制垂类引擎", "EvolutionRuntime 从对话中抽取 memory、entities、relations 和业务词表；DomainPack 把行业能力封装为可迁移资产。")
    card(d, 64, 306, 660, 94, "短期：用垂类壁垒挡住通用工具", "4 个对手都不会主动深做汽车 4S 店；我们先用场景包、企业 IM 和流程模板完成第一批落地。", C["teal"])
    card(d, 64, 430, 660, 94, "中期：沉淀数据与流程壁垒", "记忆、实体图谱、业务词表、审批动作和自动化模板会随客户使用持续增厚。", C["amber"])
    card(d, 64, 554, 660, 94, "长期：从 4S 店复制到更多门店型行业", "门店 + 导购 + CRM + 售后流程结构相似的行业，都可以通过 DomainPack 复用 Runtime。", C["blue"])
    rounded(d, (64, 704, 724, 786), "#FFF7ED", "#F1C27D", 2, 16)
    draw_wrapped(d, (94, 728), "诚实边界：品牌生态、检索基准、自演化深度仍需真实客户数据验证。", F["body"], "#8A4B00", 600, 8)
    return im


SLIDES = [slide1, slide2, slide3, slide4, slide5]


def main():
    paths = []
    for i, fn in enumerate(SLIDES, 1):
        img = fn().convert("RGB")
        path = OUT / f"enterprise-agent-{i:02d}.png"
        img.save(path, quality=95)
        paths.append(path)

    thumb_w = 480
    contact = Image.new("RGB", (thumb_w * 2 + 30, 270 * 3 + 40), "#FFFFFF")
    for idx, path in enumerate(paths):
        im = Image.open(path).convert("RGB")
        im.thumbnail((thumb_w, 270), Image.Resampling.LANCZOS)
        x = 10 + (idx % 2) * (thumb_w + 10)
        y = 10 + (idx // 2) * 270
        contact.paste(im, (x, y))
    contact.save(OUT / "contact-sheet.png", quality=95)


if __name__ == "__main__":
    main()
