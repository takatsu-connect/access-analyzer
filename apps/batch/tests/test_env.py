"""U-30（env.py の部分）: 接続文字列と環境変数の検証（03 §16、ADR 0009「TLS」、NFR-40）。

接続文字列と Hook の URL は架空の値。検証の失敗が値を外に出さないことも確かめる。
"""

import traceback
from datetime import date

import pydantic
import pytest
from pydantic import SecretStr

from takatsu_batch.env import BatchEnv, load_batch_env, load_publish_hook, parse_db_url
from takatsu_batch.errors import BatchValidationError, classify_error

USER = "batch_writer.abcdefgh"
PASSWORD = "hunter2-fake"
HOST = "db.pooler.example"
PROD_URL = f"postgresql://{USER}:{PASSWORD}@{HOST}:5432/postgres"
LOCAL_URL = "postgresql://postgres:postgres@localhost:54322/postgres"
GA4_PROPERTY_ID = "987650123"
HOOK_URL = "https://api.vercel.com/v1/integrations/deploy/prj_fake/fakeHookToken"
FORBIDDEN = (
    "batch_writer",
    "abcdefgh",
    "hunter2",
    "pooler",
    "postgresql://",
    GA4_PROPERTY_ID,
    "fakeHookToken",
    "prj_fake",
    "vercel",
)

REJECTED_DB_URLS = [
    pytest.param(f"{PROD_URL}?host=localhost", id="query-host-localhost"),
    pytest.param(f"{PROD_URL}?host=127.0.0.1", id="query-host-loopback"),
    pytest.param(f"{PROD_URL}?hostaddr=127.0.0.1", id="hostaddr"),
    pytest.param(
        f"postgresql://{USER}:{PASSWORD}@localhost:5432/postgres?hostaddr=203.0.113.5",
        id="local-host-with-remote-hostaddr",
    ),
    pytest.param(
        f"postgresql://{USER}:{PASSWORD}@{HOST},db2.pooler.example:5432/postgres", id="multi-host"
    ),
    pytest.param(
        f"postgresql://{USER}:{PASSWORD}@localhost:5432,{HOST}:5432/postgres",
        id="multi-host-local-first",
    ),
    pytest.param(
        f"postgresql://{USER}:{PASSWORD}@%2Fvar%2Frun%2Fpostgresql/postgres", id="unix-socket-host"
    ),
    pytest.param(
        f"postgresql://{USER}:{PASSWORD}@/postgres?host=/var/run/postgresql", id="unix-socket-query"
    ),
    pytest.param(f"{PROD_URL}?sslmode=disable", id="sslmode-disable"),
    pytest.param(f"{PROD_URL}?sslmode=require", id="sslmode-require"),
    pytest.param(f"{PROD_URL}?sslmode=verify-full", id="sslmode-verify-full"),
    pytest.param(f"{PROD_URL}?sslrootcert=system", id="sslrootcert"),
    pytest.param(f"{PROD_URL}?service=fake", id="service"),
    pytest.param("postgresql:///postgres?service=fake", id="service-only"),
    pytest.param(f"{PROD_URL}?passfile=fake.pgpass", id="passfile"),
    pytest.param(f"{PROD_URL}?application_name=fake", id="harmless-query"),
    pytest.param(f"{PROD_URL}#fragment", id="fragment"),
    pytest.param(f"host={HOST} user={USER} password={PASSWORD} dbname=postgres", id="key-value"),
    pytest.param(
        f"host={HOST} user={USER} password={PASSWORD} sslmode=disable", id="key-value-sslmode"
    ),
    pytest.param("", id="empty"),
    pytest.param("   ", id="blank"),
    pytest.param(f"http://{USER}:{PASSWORD}@{HOST}:5432/postgres", id="http"),
    pytest.param(f"https://{USER}:{PASSWORD}@{HOST}:5432/postgres", id="https"),
    pytest.param(f"postgresql://{USER}:{PASSWORD}@/postgres", id="no-host"),
    pytest.param(f"postgresql://{USER}:{PASSWORD}@:5432/postgres", id="empty-host-with-port"),
    pytest.param("postgresql://", id="scheme-only"),
    pytest.param(f"postgresql://{USER}:{PASSWORD}@[::1/postgres", id="broken-ipv6"),
    pytest.param(f"postgresql://{USER}:{PASSWORD}@{HOST}:5432/%zz", id="broken-percent"),
]


def _assert_no_secret(text: str) -> None:
    for word in FORBIDDEN:
        assert word not in text


# --- parse_db_url ---


@pytest.mark.parametrize("url", REJECTED_DB_URLS)
def test_parse_db_url_rejects_without_exposing_value(url: str) -> None:
    with pytest.raises(BatchValidationError) as excinfo:
        parse_db_url(SecretStr(url))
    exc = excinfo.value
    _assert_no_secret(str(exc))
    _assert_no_secret(repr(exc))
    # 表示される例外の連鎖にも、解析器のメッセージ（値を含みうる）を出さない
    _assert_no_secret("".join(traceback.format_exception(exc)))
    assert exc.args == ()
    assert classify_error(exc) == "validation"


@pytest.mark.parametrize(
    ("url", "is_local"),
    [
        pytest.param(PROD_URL, False, id="pooler"),
        pytest.param(f"postgres://{USER}:{PASSWORD}@{HOST}:5432/postgres", False, id="postgres"),
        pytest.param(f"postgresql://{USER}:p%40ss%3Aword@{HOST}:5432/postgres", False, id="escape"),
        pytest.param(f"postgresql://{USER}:{PASSWORD}@{HOST}/postgres", False, id="no-port"),
        pytest.param(LOCAL_URL, True, id="localhost"),
        pytest.param("postgresql://postgres:postgres@127.0.0.1:54322/postgres", True, id="ipv4"),
        # localhost に見えるだけの host は、ローカル扱いにしない
        pytest.param(
            f"postgresql://{USER}:{PASSWORD}@localhost.evil.example:5432/postgres",
            False,
            id="localhost-prefix",
        ),
        pytest.param(
            f"postgresql://{USER}:{PASSWORD}@127.0.0.1.evil.example:5432/postgres",
            False,
            id="loopback-prefix",
        ),
        pytest.param(f"postgresql://{USER}:{PASSWORD}@127.0.0.2:5432/postgres", False, id="other"),
        pytest.param(f"postgresql://{USER}:{PASSWORD}@[::1]:5432/postgres", False, id="ipv6"),
    ],
)
def test_parse_db_url_accepts_plain_url_and_decides_local(url: str, is_local: bool) -> None:
    secret = SecretStr(url)
    target = parse_db_url(secret)
    assert target.is_local is is_local
    assert target.url.get_secret_value() == url
    _assert_no_secret(repr(target))
    _assert_no_secret(str(target))


# --- load_batch_env ---


def _environ(**overrides: str) -> dict[str, str]:
    environ = {
        "SUPABASE_BATCH_DB_URL": PROD_URL,
        "GA4_PROPERTY_ID": GA4_PROPERTY_ID,
        "VERCEL_DEPLOY_HOOK_URL": HOOK_URL,
        # 関係のない変数は見ない
        "PATH": "fake-path",
        "PGSSLMODE": "disable",
    }
    environ.update(overrides)
    return environ


def test_load_batch_env_with_required_variables() -> None:
    env = load_batch_env(_environ())
    assert isinstance(env, BatchEnv)
    assert env.db.url.get_secret_value() == PROD_URL
    assert env.db.is_local is False
    assert env.ga4_property_id.get_secret_value() == GA4_PROPERTY_ID
    assert env.deploy_hook_url.get_secret_value() == HOOK_URL
    assert env.base_date is None
    assert env.github_run_id is None


def test_load_batch_env_with_local_database() -> None:
    env = load_batch_env(_environ(SUPABASE_BATCH_DB_URL=LOCAL_URL))
    assert env.db.is_local is True


def test_load_batch_env_hides_secrets_in_repr() -> None:
    env = load_batch_env(_environ(BASE_DATE="2026-11-04", GITHUB_RUN_ID="1234567"))
    _assert_no_secret(repr(env))
    _assert_no_secret(str(env))
    _assert_no_secret(env.model_dump_json())
    _assert_no_secret(repr(env.db))
    _assert_no_secret(repr(env.ga4_property_id))
    _assert_no_secret(repr(env.deploy_hook_url))


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("2026-11-04", date(2026, 11, 4)),
        ("2026-10-31", date(2026, 10, 31)),
        ("2026-12-31", date(2026, 12, 31)),
        ("2027-01-01", date(2027, 1, 1)),
        ("2028-02-29", date(2028, 2, 29)),
    ],
)
def test_load_batch_env_reads_optional_base_date(value: str, expected: date) -> None:
    env = load_batch_env(_environ(BASE_DATE=value, GITHUB_RUN_ID="1234567"))
    assert env.base_date == expected
    assert env.github_run_id == "1234567"


@pytest.mark.parametrize(
    "value",
    # 数字だけの文字列は UNIX 時刻として読まれうるので、YYYY-MM-DD 以外は受けない
    ["2026-02-29", "2026-13-01", "2026/11/04", "yesterday", "1762000000", "20261104"],
)
def test_load_batch_env_rejects_invalid_base_date_without_exposing_values(value: str) -> None:
    with pytest.raises(pydantic.ValidationError) as excinfo:
        load_batch_env(_environ(BASE_DATE=value))
    _assert_no_secret(str(excinfo.value))
    _assert_no_secret(repr(excinfo.value))
    assert value not in str(excinfo.value)


@pytest.mark.parametrize(
    "missing", ["SUPABASE_BATCH_DB_URL", "GA4_PROPERTY_ID", "VERCEL_DEPLOY_HOOK_URL"]
)
@pytest.mark.parametrize("how", ["absent", "empty"])
def test_load_batch_env_missing_variable_does_not_expose_the_others(missing: str, how: str) -> None:
    environ = _environ()
    if how == "absent":
        del environ[missing]
    else:
        environ[missing] = ""  # workflow_dispatch の空の入力は未設定として扱う
    with pytest.raises(pydantic.ValidationError) as excinfo:
        load_batch_env(environ)
    _assert_no_secret(str(excinfo.value))
    _assert_no_secret(repr(excinfo.value))
    # どの変数が足りないかは分かる
    assert missing in str(excinfo.value)
    assert classify_error(excinfo.value) == "validation"


def test_load_batch_env_empty_optional_variables_are_unset() -> None:
    env = load_batch_env(_environ(BASE_DATE="", GITHUB_RUN_ID=""))
    assert env.base_date is None
    assert env.github_run_id is None


def test_load_batch_env_without_any_variable() -> None:
    with pytest.raises(pydantic.ValidationError) as excinfo:
        load_batch_env({})
    assert excinfo.value.error_count() == 3


@pytest.mark.parametrize(
    "value",
    ["properties/123", "１２３", "²", "12 3", " 123", "-123", "12.3", "123abc"],
    ids=[
        "resource-name",
        "fullwidth",
        "superscript",
        "inner-space",
        "leading-space",
        "negative",
        "decimal",
        "letters",
    ],
)
def test_load_batch_env_rejects_non_numeric_property_id(value: str) -> None:
    with pytest.raises(BatchValidationError) as excinfo:
        load_batch_env(_environ(GA4_PROPERTY_ID=value))
    _assert_no_secret(str(excinfo.value))
    assert value not in str(excinfo.value)


@pytest.mark.parametrize(
    "value",
    [
        "http://api.vercel.com/v1/integrations/deploy/prj_fake/fakeHookToken",
        "ftp://api.vercel.com/fakeHookToken",
        "HTTPS://api.vercel.com/v1/integrations/deploy/prj_fake/fakeHookToken",
        " https://api.vercel.com/v1/integrations/deploy/prj_fake/fakeHookToken",
        "api.vercel.com/v1/integrations/deploy/prj_fake/fakeHookToken",
        "https:/api.vercel.com/v1/integrations/deploy/prj_fake/fakeHookToken",
        # 宛先は Vercel の Deploy Hook に限る（監査 L-5）
        "https://api.vercel.example/v1/integrations/deploy/prj_fake/fakeHookToken",
        "https://api.vercel.com.evil.example/v1/integrations/deploy/prj_fake/fakeHookToken",
        "https://evil.example/?u=https://api.vercel.com/v1/integrations/deploy/prj_fake/x",
        "https://api.vercel.com/v2/other/fakeHookToken",
    ],
    ids=[
        "http",
        "ftp",
        "uppercase",
        "leading-space",
        "no-scheme",
        "one-slash",
        "other-host",
        "host-suffix",
        "embedded",
        "other-path",
    ],
)
def test_hook_url_must_be_a_vercel_deploy_hook(value: str) -> None:
    with pytest.raises(BatchValidationError) as batch_excinfo:
        load_batch_env(_environ(VERCEL_DEPLOY_HOOK_URL=value))
    _assert_no_secret(str(batch_excinfo.value))
    with pytest.raises(BatchValidationError) as publish_excinfo:
        load_publish_hook({"VERCEL_DEPLOY_HOOK_URL": value})
    _assert_no_secret(str(publish_excinfo.value))


@pytest.mark.parametrize("value", ["run-12", "12 34", "１２３", "12;drop"])
def test_github_run_id_must_be_digits(value: str) -> None:
    # batch_run に書く値なので、数字だけを受ける（監査 L-5）
    with pytest.raises(BatchValidationError) as excinfo:
        load_batch_env(_environ(GITHUB_RUN_ID=value))
    assert value not in str(excinfo.value)


@pytest.mark.parametrize("host", ["@abstract", "%40abstract"])
def test_abstract_socket_host_is_rejected(host: str) -> None:
    # @ で始まる host は抽象ソケットとして扱われる（監査 L-4）
    url = SecretStr(f"postgresql://{USER}:{PASSWORD}@{host}/postgres")
    with pytest.raises(BatchValidationError) as excinfo:
        parse_db_url(url)
    _assert_no_secret(str(excinfo.value))


def test_load_batch_env_rejects_bad_db_url() -> None:
    with pytest.raises(BatchValidationError) as excinfo:
        load_batch_env(_environ(SUPABASE_BATCH_DB_URL=f"{PROD_URL}?sslmode=disable"))
    _assert_no_secret(str(excinfo.value))


# --- load_publish_hook ---


def test_load_publish_hook_needs_only_the_hook() -> None:
    hook = load_publish_hook({"VERCEL_DEPLOY_HOOK_URL": HOOK_URL})
    assert hook.get_secret_value() == HOOK_URL
    _assert_no_secret(repr(hook))
    _assert_no_secret(str(hook))


@pytest.mark.parametrize("environ", [{}, {"VERCEL_DEPLOY_HOOK_URL": ""}], ids=["absent", "empty"])
def test_load_publish_hook_missing(environ: dict[str, str]) -> None:
    with pytest.raises(pydantic.ValidationError) as excinfo:
        load_publish_hook(environ)
    assert "VERCEL_DEPLOY_HOOK_URL" in str(excinfo.value)
