from gongmun.llm.client import PRICING, ROUTES, Usage, estimate_unit_cost


class FakeUsage:
    def __init__(self, inp=0, out=0, read=0, write=0):
        self.input_tokens = inp
        self.output_tokens = out
        self.cache_read_input_tokens = read
        self.cache_creation_input_tokens = write


def test_every_route_has_a_price():
    for task, model in ROUTES.items():
        assert model in PRICING, f"{task} -> {model} 요금 없음"


def test_usage_accumulates_cost():
    u = Usage()
    u.add("claude-opus-5-5", FakeUsage(inp=1_000_000, out=0))
    assert u.usd == 4.0
    u.add("claude-opus-5-5", FakeUsage(out=1_000_000))
    assert u.usd == 24.0
    assert u.calls == 2
    assert u.by_model["claude-opus-5-5"] == 2


def test_cache_read_is_far_cheaper_than_fresh_input():
    u = Usage()
    u.add("claude-opus-5-5", FakeUsage(read=1_000_000))
    assert u.usd == 0.20


def test_unknown_model_rejected():
    import pytest

    with pytest.raises(ValueError):
        Usage().add("claude-nonexistent", FakeUsage(inp=10))


def test_caching_reduces_unit_cost():
    cached = estimate_unit_cost(
        cached_tokens=150_000, fresh_input_tokens=8_000, output_tokens=30_000
    )
    assert cached["usd"] < cached["usd_without_cache"]
    assert cached["saved_pct"] > 40


def test_haiku_is_cheaper_than_opus_for_same_work():
    args = dict(cached_tokens=0, fresh_input_tokens=40_000, output_tokens=3_000)
    haiku = estimate_unit_cost(**args, model="claude-haiku-5-5")["usd"]
    opus = estimate_unit_cost(**args, model="claude-opus-5-5")["usd"]
    assert haiku * 20 < opus
