# jumpmap

Get the eve static data export here: https://cdn1.eveonline.com/data/sde/tranquility/sde-20160912-TRANQUILITY.zip

Then from sde/fsd/universe/eve, this is the command I was using to run process.js:

echo "[" > ~/evesystems.json ; find . -name 'solarsystem.staticdata' | grep -iv 'uua-f4' | grep -iv 'a821-a' | grep -iv 'j7hz-f' | xargs node ~/maptool/process.js >> ~/evesystems.json; echo "]" >> ~/evesystems.json

Watch out for hardcoded paths.