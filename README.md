# jumpmap

echo "[" > ~/evesystems.json ; find . -name 'solarsystem.staticdata' | grep -iv 'uua-f4' | grep -iv 'a821-a' | grep -iv 'j7hz-f' | xargs node ~/maptool/process.js >> ~/evesystems.json; echo "]" >> ~/evesystems.json