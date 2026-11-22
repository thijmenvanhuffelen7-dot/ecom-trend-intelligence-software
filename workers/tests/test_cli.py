"""De CLI biedt alle commando's waar de docs en de Makefile naar verwijzen."""

import subprocess
import sys

EXPECTED = [
    "seed",
    "simulate",
    "crawl-store",
    "tick",
    "discover",
    "index-search",
    "screenshots",
    "cluster",
    "score",
    "backtest",
    "analyze-creatives",
]


def test_cli_lists_all_commands():
    out = subprocess.run(
        [sys.executable, "-c", "import sys; from trendscope.cli import main; sys.argv=['trendscope','-h']; main()"],
        capture_output=True,
        text=True,
        check=False,
    ).stdout
    missing = [c for c in EXPECTED if c not in out]
    assert not missing, f"ontbrekende subcommando's: {missing}"
