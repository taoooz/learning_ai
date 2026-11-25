"""evals.stats — 评测统计工具（纯 Python 标准库，无 scipy/numpy 依赖）。

提供：
- paired_bootstrap_ci: 配对差值 bootstrap 置信区间（固定种子可复现）
- sign_test: 符号检验（精确二项，双侧）
- paired_permutation_test: 配对符号翻转置换检验（固定种子可复现）
- cohens_kappa / agreement_rate: 评审一致性（judge vs 人工校准）
- wilson_interval: 胜率 Wilson 区间
- minimum_detectable_effect / required_sample_size / achieved_power:
  胜率差的最小可检测效应与功效估算（正态近似，statistics.NormalDist）

真实仓库 .venv 无 scipy/numpy（pip freeze 核实），故全部自实现。

CLI（README 片段）：
    cd python-agent
    # 对一组配对差值（如 A/B 评审得分差）计算 95% bootstrap CI 与符号检验
    python -m evals.stats --diffs 0.2,-0.1,0.4,0.0,0.3 --seed 42
    # 估算 n 对比较在 80% 功效下能检测的最小胜率差
    python -m evals.stats --mde-n 60
    # 已知答案自检（κ 参考值对照）
    python -m evals.stats --self-check
"""
from __future__ import annotations

import argparse
import json
import math
import random
from statistics import NormalDist

_Z = NormalDist()


def mean(values: list[float]) -> float:
    return sum(values) / len(values) if values else 0.0


def _percentile(sorted_values: list[float], q: float) -> float:
    """线性插值分位数（q ∈ [0,1]），输入须已排序且非空。"""
    if not sorted_values:
        raise ValueError("percentile of empty sequence")
    pos = q * (len(sorted_values) - 1)
    lo = math.floor(pos)
    hi = math.ceil(pos)
    if lo == hi:
        return sorted_values[int(pos)]
    return sorted_values[lo] + (sorted_values[hi] - sorted_values[lo]) * (pos - lo)


def paired_bootstrap_ci(
    diffs: list[float],
    n_resamples: int = 10000,
    confidence: float = 0.95,
    seed: int = 42,
) -> dict:
    """配对差值均值的 percentile bootstrap 置信区间。

    diffs: 每对 (A-B) 的差值（配对检验要求同一对内的差）。
    固定 seed 时结果完全可复现（random.Random(seed) 独立实例，不污染全局）。
    """
    if not diffs:
        return {"mean": 0.0, "lower": 0.0, "upper": 0.0, "n": 0,
                "confidence": confidence, "n_resamples": n_resamples, "seed": seed}
    rng = random.Random(seed)
    n = len(diffs)
    means = []
    for _ in range(n_resamples):
        sample = [diffs[rng.randrange(n)] for _ in range(n)]
        means.append(sum(sample) / n)
    means.sort()
    alpha = 1.0 - confidence
    return {
        "mean": mean(diffs),
        "lower": _percentile(means, alpha / 2),
        "upper": _percentile(means, 1 - alpha / 2),
        "n": n,
        "confidence": confidence,
        "n_resamples": n_resamples,
        "seed": seed,
    }


def sign_test(wins: int, losses: int) -> dict:
    """符号检验（平局剔除），精确二项双侧 p 值 = 2×较小尾概率（截断到 1）。

    例：wins=8, losses=2 → p = 2×(C(10,8)+C(10,9)+C(10,10))/2^10 = 0.109375。
    """
    if wins < 0 or losses < 0:
        raise ValueError("wins/losses 不能为负")
    n = wins + losses
    if n == 0:
        return {"n": 0, "wins": wins, "losses": losses, "p_value": 1.0}
    k = min(wins, losses)
    tail = sum(math.comb(n, i) for i in range(0, k + 1)) / (2 ** n)
    return {"n": n, "wins": wins, "losses": losses, "p_value": min(1.0, 2 * tail)}


def paired_permutation_test(
    diffs: list[float],
    n_permutations: int = 10000,
    seed: int = 42,
) -> dict:
    """配对符号翻转置换检验（双侧）。

    H0: 差值分布关于 0 对称。每次置换独立翻转每个差值符号，
    p = (|置换均值| >= |观测均值| 的次数 + 1) / (n_permutations + 1)。
    固定 seed 可复现；全零差值时 p=1。
    """
    if not diffs:
        return {"observed_mean": 0.0, "p_value": 1.0, "n": 0,
                "n_permutations": n_permutations, "seed": seed}
    rng = random.Random(seed)
    n = len(diffs)
    observed = abs(mean(diffs))
    if observed == 0:
        return {"observed_mean": 0.0, "p_value": 1.0, "n": n,
                "n_permutations": n_permutations, "seed": seed}
    exceed = 0
    for _ in range(n_permutations):
        flipped = [d if rng.random() < 0.5 else -d for d in diffs]
        if abs(sum(flipped) / n) >= observed - 1e-12:
            exceed += 1
    return {
        "observed_mean": mean(diffs),
        "p_value": (exceed + 1) / (n_permutations + 1),
        "n": n,
        "n_permutations": n_permutations,
        "seed": seed,
    }


def agreement_rate(rater_a: list, rater_b: list) -> float:
    """原始一致率（逐位置相等比例）。长度不等时按较短对齐并视为不一致超出部分。"""
    if not rater_a and not rater_b:
        return 1.0
    n = max(len(rater_a), len(rater_b))
    same = sum(1 for x, y in zip(rater_a, rater_b) if x == y)
    return same / n


def cohens_kappa(rater_a: list, rater_b: list) -> float:
    """Cohen's κ（两评分者、类别标签）。

    κ = (po - pe) / (1 - pe)；pe 为边际分布乘积之和。
    退化情形：pe == 1 时，完全一致返回 1.0，否则 0.0。
    空输入返回 1.0（无分歧）。长度须一致，否则抛 ValueError。
    """
    if len(rater_a) != len(rater_b):
        raise ValueError("两评分者标注数量不一致")
    n = len(rater_a)
    if n == 0:
        return 1.0
    labels = set(rater_a) | set(rater_b)
    po = sum(1 for x, y in zip(rater_a, rater_b) if x == y) / n
    pe = sum((rater_a.count(c) / n) * (rater_b.count(c) / n) for c in labels)
    if pe == 1.0:
        return 1.0 if po == 1.0 else 0.0
    return (po - pe) / (1 - pe)


def wilson_interval(successes: int, n: int, confidence: float = 0.95) -> tuple[float, float]:
    """二项比例 Wilson 得分区间（胜率报告用，小样本比正态近似稳健）。"""
    if n == 0:
        return (0.0, 1.0)
    z = _Z.inv_cdf(1 - (1 - confidence) / 2)
    p = successes / n
    denom = 1 + z * z / n
    center = (p + z * z / (2 * n)) / denom
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / denom
    return (max(0.0, center - half), min(1.0, center + half))


def achieved_power(n: int, effect: float, alpha: float = 0.05, baseline: float = 0.5) -> float:
    """单样本胜率检验功效（正态近似）：H0 p=baseline，真实 p=baseline+effect。

    power = Φ((δ√n − z_{α/2}·√(p0(1−p0))) / √(p1(1−p1)))。
    effect<=0 或 n<=0 时返回 0。
    """
    if n <= 0 or effect <= 0:
        return 0.0
    p0 = baseline
    p1 = min(0.999999, baseline + effect)
    z_alpha = _Z.inv_cdf(1 - alpha / 2)
    sd0 = math.sqrt(p0 * (1 - p0))
    sd1 = math.sqrt(p1 * (1 - p1)) or 1e-9
    return _Z.cdf((effect * math.sqrt(n) - z_alpha * sd0) / sd1)


def minimum_detectable_effect(
    n: int, alpha: float = 0.05, power: float = 0.8, baseline: float = 0.5
) -> float:
    """给定对数 n，在指定功效下可检测的最小胜率差 δ（二分求解，确定性）。

    用于回答"60 对盲评够不够检测出 10 个百分点的胜率差"。
    """
    if n <= 0:
        return float("inf")
    lo, hi = 0.0, 1.0 - baseline
    if achieved_power(n, hi, alpha, baseline) < power:
        return float("inf")
    for _ in range(80):
        mid = (lo + hi) / 2
        if achieved_power(n, mid, alpha, baseline) >= power:
            hi = mid
        else:
            lo = mid
    return hi


def required_sample_size(
    mde: float, alpha: float = 0.05, power: float = 0.8, baseline: float = 0.5
) -> int:
    """检测指定胜率差所需的最少配对数（向上取整）。"""
    if mde <= 0:
        return 0
    n = 1
    while achieved_power(n, mde, alpha, baseline) < power:
        n *= 2
        if n > 10_000_000:
            raise ValueError("所需样本量超出合理范围")
    lo, hi = max(1, n // 2), n
    while lo < hi:
        mid = (lo + hi) // 2
        if achieved_power(mid, mde, alpha, baseline) >= power:
            hi = mid
        else:
            lo = mid + 1
    return lo


def _self_check() -> dict:
    """已知答案自检：κ 经典算例 + 符号检验参考值 + bootstrap 复现性。"""
    # 经典算例：100 条，两评分者各 50/50 分类，一致 70 条 → po=0.7, pe=0.5, κ=0.4
    a = ["yes"] * 50 + ["no"] * 50
    b = ["yes"] * 35 + ["no"] * 15 + ["yes"] * 15 + ["no"] * 35
    kappa = cohens_kappa(a, b)
    st = sign_test(8, 2)
    ci1 = paired_bootstrap_ci([0.2, -0.1, 0.4, 0.0, 0.3], n_resamples=2000, seed=42)
    ci2 = paired_bootstrap_ci([0.2, -0.1, 0.4, 0.0, 0.3], n_resamples=2000, seed=42)
    return {
        "kappa_expected_0.4": kappa,
        "kappa_ok": abs(kappa - 0.4) < 1e-9,
        "sign_test_expected_0.109375": st["p_value"],
        "sign_test_ok": abs(st["p_value"] - 0.109375) < 1e-9,
        "bootstrap_reproducible": ci1 == ci2,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="评测统计工具（详见模块 docstring）")
    parser.add_argument("--diffs", help="逗号分隔的配对差值，如 0.2,-0.1,0.4")
    parser.add_argument("--wins", type=int, help="符号检验胜场数")
    parser.add_argument("--losses", type=int, help="符号检验负场数")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--resamples", type=int, default=10000)
    parser.add_argument("--mde-n", type=int, help="给定对数估算最小可检测胜率差")
    parser.add_argument("--mde", type=float, help="给定胜率差估算所需对数")
    parser.add_argument("--self-check", action="store_true")
    args = parser.parse_args()

    out: dict = {}
    if args.self_check:
        out["self_check"] = _self_check()
    if args.diffs:
        diffs = [float(x) for x in args.diffs.split(",") if x.strip()]
        out["bootstrap_ci"] = paired_bootstrap_ci(diffs, n_resamples=args.resamples, seed=args.seed)
        out["permutation_test"] = paired_permutation_test(diffs, n_permutations=args.resamples, seed=args.seed)
    if args.wins is not None and args.losses is not None:
        out["sign_test"] = sign_test(args.wins, args.losses)
    if args.mde_n:
        out["mde"] = minimum_detectable_effect(args.mde_n)
    if args.mde:
        out["required_n"] = required_sample_size(args.mde)
    if not out:
        parser.print_help()
        return
    print(json.dumps(out, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()