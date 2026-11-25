# tests/test_eval_stats.py — evals.stats 统计工具：已知答案对照 + 可复现性
import math

import pytest

from evals.stats import (
    agreement_rate,
    achieved_power,
    cohens_kappa,
    minimum_detectable_effect,
    paired_bootstrap_ci,
    paired_permutation_test,
    required_sample_size,
    sign_test,
    wilson_interval,
)


# ---- Cohen's κ：已知答案对照 ----

def test_kappa_classic_known_answer():
    # 经典算例：100 条，两评分者边际各 50/50，一致 70 条 → po=0.7, pe=0.5, κ=0.4
    a = ["yes"] * 50 + ["no"] * 50
    b = ["yes"] * 35 + ["no"] * 15 + ["yes"] * 15 + ["no"] * 35
    assert cohens_kappa(a, b) == pytest.approx(0.4, abs=1e-12)


def test_kappa_perfect_agreement():
    labels = ["a", "b", "tie", "a", "b"]
    assert cohens_kappa(labels, labels) == pytest.approx(1.0)


def test_kappa_chance_level():
    # 完全按边际随机重合的构造：po == pe → κ = 0
    a = ["a", "a", "b", "b"]
    b = ["a", "b", "a", "b"]
    assert cohens_kappa(a, b) == pytest.approx(0.0, abs=1e-12)


def test_kappa_degenerate_single_category():
    # pe == 1：全同一类别，完全一致 → 1.0
    assert cohens_kappa(["a"] * 5, ["a"] * 5) == 1.0


def test_kappa_empty_and_mismatch():
    assert cohens_kappa([], []) == 1.0
    with pytest.raises(ValueError):
        cohens_kappa(["a"], ["a", "b"])


def test_agreement_rate_known():
    assert agreement_rate(["a", "b", "tie", "a"], ["a", "b", "a", "a"]) == 0.75


# ---- 符号检验：精确二项参考值 ----

def test_sign_test_known_p_value():
    # 8 胜 2 负：p = 2×(C(10,8)+C(10,9)+C(10,10))/2^10 = 0.109375
    result = sign_test(8, 2)
    assert result["p_value"] == pytest.approx(0.109375, abs=1e-12)
    assert result["n"] == 10


def test_sign_test_symmetric_and_empty():
    assert sign_test(2, 8)["p_value"] == pytest.approx(sign_test(8, 2)["p_value"])
    assert sign_test(0, 0)["p_value"] == 1.0
    assert sign_test(10, 0)["p_value"] == pytest.approx(2 / 1024)


def test_sign_test_negative_raises():
    with pytest.raises(ValueError):
        sign_test(-1, 2)


# ---- bootstrap：固定种子可复现 ----

def test_bootstrap_reproducible_fixed_seed():
    diffs = [0.2, -0.1, 0.4, 0.0, 0.3, 0.15, -0.05]
    ci1 = paired_bootstrap_ci(diffs, n_resamples=3000, seed=42)
    ci2 = paired_bootstrap_ci(diffs, n_resamples=3000, seed=42)
    assert ci1 == ci2  # 完全一致（含区间端点）


def test_bootstrap_ci_covers_mean_and_orders():
    diffs = [0.2, -0.1, 0.4, 0.0, 0.3]
    ci = paired_bootstrap_ci(diffs, n_resamples=5000, seed=7)
    assert ci["lower"] <= ci["mean"] <= ci["upper"]
    assert ci["mean"] == pytest.approx(sum(diffs) / len(diffs))


def test_bootstrap_different_seed_differs():
    diffs = [0.2, -0.1, 0.4, 0.0, 0.3, 0.5, -0.2, 0.1]
    ci1 = paired_bootstrap_ci(diffs, n_resamples=2000, seed=1)
    ci2 = paired_bootstrap_ci(diffs, n_resamples=2000, seed=2)
    assert (ci1["lower"], ci1["upper"]) != (ci2["lower"], ci2["upper"])


def test_bootstrap_empty():
    ci = paired_bootstrap_ci([])
    assert ci["n"] == 0 and ci["lower"] == 0.0


# ---- 置换检验 ----

def test_permutation_reproducible():
    # n=8 全正差值：双侧精确最小 p=2/2^8≈0.0078，可达显著
    # （n=5 时最小 p=2/32=0.0625，双侧不可能 <0.05——样本量本身限制）
    diffs = [0.3, 0.2, 0.4, 0.1, 0.5, 0.25, 0.35, 0.15]
    r1 = paired_permutation_test(diffs, n_permutations=2000, seed=42)
    r2 = paired_permutation_test(diffs, n_permutations=2000, seed=42)
    assert r1 == r2
    assert r1["p_value"] < 0.05  # 全正差值应显著


def test_permutation_null():
    assert paired_permutation_test([0.0, 0.0], n_permutations=100)["p_value"] == 1.0
    assert paired_permutation_test([], n_permutations=100)["p_value"] == 1.0


# ---- Wilson 区间与功效 ----

def test_wilson_interval_bounds():
    lo, hi = wilson_interval(7, 10)
    assert 0 < lo < 0.7 < hi < 1
    assert wilson_interval(0, 0) == (0.0, 1.0)


def test_mde_decreases_with_n():
    mde_30 = minimum_detectable_effect(30)
    mde_120 = minimum_detectable_effect(120)
    assert 0 < mde_120 < mde_30 < 0.5


def test_required_sample_size_roundtrip():
    n = required_sample_size(0.15, power=0.8)
    assert achieved_power(n, 0.15) >= 0.8
    assert achieved_power(n - 1, 0.15) < 0.8


def test_achieved_power_edges():
    assert achieved_power(0, 0.2) == 0.0
    assert achieved_power(100, 0.0) == 0.0
    assert achieved_power(10000, 0.3) > 0.99


def test_mde_impossible_returns_inf():
    assert math.isinf(minimum_detectable_effect(2, power=0.99))