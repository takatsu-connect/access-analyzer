"""S-18: 例外の情報を使わないことの静的検査（03 §14 の 2、経路監査 L-5、W-7）。"""

import ast
import re
import sys
from collections.abc import Iterator
from pathlib import Path

import pytest

SRC = Path(__file__).resolve().parents[1] / "src" / "takatsu_batch"
MODULES = sorted(SRC.rglob("*.py"))
# except の束縛名を渡してよい先。
# _normalized_exit_code は SystemExit の code を int にするだけ（03 §14 の 1）
ALLOWED_RECEIVERS = {"classify_error", "_normalized_exit_code"}
FORBIDDEN_TEXT = re.compile(
    r"\.diag\b|\.pgconn\b|\.pgresult\b|format_exc|format_exception|print_exc"
    r"|logging\.exception|basicConfig|__context__|__traceback__|__cause__"
)
# __main__.py が logging で使ってよい名前（03 §14 の 4・5）
ALLOWED_LOGGING_ATTRS = {
    "disable",
    "CRITICAL",
    "raiseExceptions",
    "getLogger",
    "NullHandler",
    "lastResort",
}


def _parents(tree: ast.AST) -> dict[ast.AST, ast.AST]:
    return {child: parent for parent in ast.walk(tree) for child in ast.iter_child_nodes(parent)}


def _except_binding_uses(tree: ast.AST) -> Iterator[tuple[ast.Name, dict[ast.AST, ast.AST]]]:
    parents = _parents(tree)
    for handler in ast.walk(tree):
        if not isinstance(handler, ast.ExceptHandler) or handler.name is None:
            continue
        for statement in handler.body:
            for node in ast.walk(statement):
                if isinstance(node, ast.Name) and node.id == handler.name:
                    yield node, parents


def _called_name(call: ast.Call) -> str | None:
    func = call.func
    if isinstance(func, ast.Name):
        return func.id
    if isinstance(func, ast.Attribute):
        return func.attr
    return None


@pytest.mark.parametrize("path", MODULES, ids=lambda p: p.name)
def test_except_binding_is_only_passed_to_classifier(path: Path) -> None:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    for node, parents in _except_binding_uses(tree):
        parent = parents[node]
        assert isinstance(parent, ast.Call), f"{path.name}:{node.lineno}"
        assert _called_name(parent) in ALLOWED_RECEIVERS, f"{path.name}:{node.lineno}"
        assert parent.args == [node], f"{path.name}:{node.lineno}"


@pytest.mark.parametrize("path", MODULES, ids=lambda p: p.name)
def test_forbidden_text_is_absent(path: Path) -> None:
    assert FORBIDDEN_TEXT.search(path.read_text(encoding="utf-8")) is None


def test_binding_check_detects_violations() -> None:
    # 検査そのものが働くことを確かめる
    bad = "try:\n    pass\nexcept Exception as anything:\n    show(str(anything))\n"
    uses = list(_except_binding_uses(ast.parse(bad)))
    assert len(uses) == 1
    node, parents = uses[0]
    assert _called_name(parents[node]) == "str"  # type: ignore[arg-type]


def test_errors_module_only_reads_sqlstate() -> None:
    tree = ast.parse((SRC / "errors.py").read_text(encoding="utf-8"))
    parameter_names = {"exc"}
    read_attrs = {
        node.attr
        for node in ast.walk(tree)
        if isinstance(node, ast.Attribute)
        and isinstance(node.value, ast.Name)
        and node.value.id in parameter_names
    }
    assert read_attrs == {"sqlstate"}
    calls = {_called_name(n) for n in ast.walk(tree) if isinstance(n, ast.Call)}
    assert calls <= {"isinstance", "_classify_psycopg", "frozenset"}


def _top_level_imports(tree: ast.Module) -> set[str]:
    names: set[str] = set()
    for node in tree.body:
        if isinstance(node, ast.Import):
            names.update(alias.name.split(".")[0] for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            names.add((node.module or "").split(".")[0])
    return names


@pytest.mark.parametrize("name", ["__main__.py", "__init__.py"])
def test_entry_top_level_imports_are_stdlib_only(name: str) -> None:
    tree = ast.parse((SRC / name).read_text(encoding="utf-8"))
    assert _top_level_imports(tree) <= sys.stdlib_module_names


def test_init_is_empty() -> None:
    tree = ast.parse((SRC / "__init__.py").read_text(encoding="utf-8"))
    assert tree.body == []


def test_main_uses_logging_only_to_silence() -> None:
    tree = ast.parse((SRC / "__main__.py").read_text(encoding="utf-8"))
    used = {
        node.attr
        for node in ast.walk(tree)
        if isinstance(node, ast.Attribute)
        and isinstance(node.value, ast.Name)
        and node.value.id == "logging"
    }
    assert used == ALLOWED_LOGGING_ATTRS


def test_main_does_not_enable_faulthandler_or_reraise() -> None:
    source = (SRC / "__main__.py").read_text(encoding="utf-8")
    assert "faulthandler" not in source
    tree = ast.parse(source)
    assert not any(isinstance(node, ast.Raise) for node in ast.walk(tree))


@pytest.mark.parametrize("path", MODULES, ids=lambda p: p.name)
def test_no_print_or_stderr(path: Path) -> None:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    for node in ast.walk(tree):
        assert not (isinstance(node, ast.Name) and node.id == "print"), path.name
        assert not (isinstance(node, ast.Attribute) and node.attr == "stderr"), path.name
