from bot.ukraine_plate import format_ukraine_plate, is_valid_ukraine_plate, normalize_ukraine_plate, parse_ukraine_plate


def test_parse_accepts_latin_and_cyrillic():
    assert parse_ukraine_plate("BX5874HX") == "BX5874HX"
    assert parse_ukraine_plate("ВХ5874НХ") == "BX5874HX"
    assert parse_ukraine_plate("АО3422ТЕ") == "AO3422TE"
    assert parse_ukraine_plate("АO3422TЕ") == "AO3422TE"


def test_format_and_validate_mixed_scripts():
    assert format_ukraine_plate("ао3422те") == "AO 3422 TE"
    assert is_valid_ukraine_plate("АО 3422 ТЕ") is True
    assert is_valid_ukraine_plate("AO 3422 TE") is True
    assert normalize_ukraine_plate("АО3422ТЕ") == "AO 3422 TE"
