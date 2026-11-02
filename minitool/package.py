"""Deterministic upload archive; a decimal 10 MB limit, including ZIP metadata."""
from pathlib import Path
from datetime import date
import argparse, hashlib, json, zipfile
project = Path(__file__).resolve().parent.parent
root = project / 'minitool/dist'
parser = argparse.ArgumentParser(description=__doc__)
stamp = date.today().strftime('%Y%m%d')
parser.add_argument('--output', type=Path,
                    default=Path(f'artifacts/xhs-minitool-{stamp}/dota-xiaohongshu-{stamp}.zip'),
                    help='ZIP path, relative to the project root unless absolute')
args = parser.parse_args()
archive = (project / args.output).resolve()
assert archive.suffix == '.zip', 'Output must end in .zip'
assert not archive.is_relative_to(root.resolve()), 'Output must be outside minitool/dist'
output = archive.parent
output.mkdir(parents=True, exist_ok=True)
allowed = {'.html', '.css', '.js', '.json', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.woff', '.woff2'}
files = sorted(p for p in root.rglob('*') if p.is_file())
assert len(files) <= 200, f'Package exceeds 200-file limit: {len(files)}'
assert root / 'index.html' in files
assert sum(p.suffix == '.html' for p in files) == 1
temporary = archive.with_suffix('.zip.tmp')
with zipfile.ZipFile(temporary, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for file in files:
        assert file.suffix in allowed, file
        assert not file.is_symlink(), file
        # Fixed ZIP metadata makes identical inputs reproducible across releases.
        info = zipfile.ZipInfo(file.relative_to(root).as_posix(), (1980, 1, 1, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        info.external_attr = 0o100644 << 16
        z.writestr(info, file.read_bytes(), compresslevel=9)
size = temporary.stat().st_size
assert size < 10_000_000, f'Archive exceeds decimal 10 MB limit: {size}'
with zipfile.ZipFile(temporary) as z:
    assert z.testzip() is None
    assert 'index.html' in z.namelist()
    assert sum(n.endswith('.html') for n in z.namelist()) == 1
    assert len(z.infolist()) <= 200
    report = {'archive': str(archive), 'bytes': size, 'limitBytes': 10_000_000,
              'spareBytes': 10_000_000-size, 'sha256': hashlib.sha256(temporary.read_bytes()).hexdigest(),
              'files': len(z.infolist()), 'limitFiles': 200, 'uncompressedBytes': sum(i.file_size for i in z.infolist()),
              'browserValidation': 'auxiliary debugging only; not XHS container acceptance',
              'pending': ['XHS simulator', 'Android scan', 'iOS scan', 'Chrome 61 runtime/CSS and real-device performance']}
temporary.replace(archive)
(output / f'{archive.stem}-report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n')
print(json.dumps(report, ensure_ascii=False, indent=2))
