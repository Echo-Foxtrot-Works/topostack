"""Download and verify the pinned source files the data builders start from."""
import hashlib
from pathlib import Path
import shutil
import time
import urllib.error
import urllib.request


def file_sha256(path):
    """Hex SHA-256 of a file, read in blocks."""
    with open(path, 'rb') as file:
        return hashlib.file_digest(file, 'sha256').hexdigest()


def download(url, path, *, user_agent='TopoStack data build', timeout=300, retries=0):
    """Fetch `url` to `path` through a sibling .part file, so an interrupted download never looks complete.

    Network failures and server errors are tried again up to `retries` times,
    a little longer apart each time; a client error such as 404 fails at once.
    """
    path = Path(path)
    partial = path.with_name(path.name + '.part')
    request = urllib.request.Request(url, headers={'User-Agent': user_agent})
    for attempt in range(retries + 1):
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response, partial.open('wb') as out:
                shutil.copyfileobj(response, out)
            break
        except OSError as error:
            partial.unlink(missing_ok=True)
            if attempt == retries or (isinstance(error, urllib.error.HTTPError) and error.code < 500):
                raise
            time.sleep(2 * (attempt + 1))
    partial.replace(path)
