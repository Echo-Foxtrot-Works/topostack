"""Download and verify the pinned source files the data builders start from."""
import hashlib
from pathlib import Path
import shutil
import urllib.request


def file_sha256(path):
    """Hex SHA-256 of a file, read in blocks."""
    with open(path, 'rb') as file:
        return hashlib.file_digest(file, 'sha256').hexdigest()


def download(url, path, *, user_agent='TopoStack data build', timeout=300):
    """Fetch `url` to `path` through a sibling .part file, so an interrupted download never looks complete."""
    path = Path(path)
    partial = path.with_name(path.name + '.part')
    request = urllib.request.Request(url, headers={'User-Agent': user_agent})
    with urllib.request.urlopen(request, timeout=timeout) as response, partial.open('wb') as out:
        shutil.copyfileobj(response, out)
    partial.replace(path)
