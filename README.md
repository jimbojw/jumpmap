# jumpmap

## Creating evesystems.ldj

The first part of the pipeline is to create a single Line-delimited JSON (ldj) file called `evesystems.ldj`, which contains content like this:

```js
{"x":247214573374351000,"y":-9891860814684302,"z":44451838338475340,"security":-0.174127254,"securityClass":"null","name":"L5Y4-M"}
{"x":248242822600184800,"y":623290537651721,"z":76487755608320540,"security":-0.832725811,"securityClass":"null","name":"XY-ZCI"}
{"x":243734896421053220,"y":-850201603205642,"z":60882770710192080,"security":-0.619078973,"securityClass":"null","name":"SY-OLX"}
{"x":249247706538467330,"y":-12005708991547850,"z":60584870647700690,"security":-0.622987477,"securityClass":"null","name":"W-CSFY"}
...
```

The xyz coordinates are measured in meters in world space.

First, you'll need to get the [Static Data Export](https://developers.eveonline.com/resource/resources) (sde) tranquility data for processing.
Open a terminal to this project's directory and run these commands.

```sh
$ cd ./data
$ curl -O https://cdn1.eveonline.com/data/sde/tranquility/sde-20160912-TRANQUILITY.zip
$ unzip sde-20160912-TRANQUILITY.zip
```

Now you can create `evesystems.ldj`.
To create this file, use `npm run process`:

```sh
$ npm run process

> jumpmap@0.1.0 process ./jumpmap
> > ./data/evesystems.ldj ; find ./data/sde/fsd/universe/eve -name 'solarsystem.staticdata' | grep -iv 'uua-f4' | grep -iv 'a821-a' | grep -iv 'j7hz-f' | xargs node ./maptool/process.js >> ./data/evesystems.ldj

done processing 1739 systems.
done processing 1749 systems.
done processing 1713 systems.
```

## Creating eve.json

Once you have an `evesystems.ldj` which lists all of the eve systems, now you can create `eve.json`, the backing data for the visualizaton.
This includes nodes and edges where nodes are systems and edges represent a jump distance of less than seven light years.

To create `eve.json`, use `npm run process2`:

```sh
$ npm run process2

> jumpmap@0.1.0 process2 ./jumpmap
> node ./maptool/process2.js ./data/evesystems.ldj > ./web/eve.json
```

This may take quite a while.
When it's done, you can inspect the JSON file using [`jq`](https://stedolan.github.io/jq/).

```sh
$ cat ./web/eve.json | jq '.' | head -n 20
{
  "nodes": [
    {
      "id": "Litom",
      "group": 0
    },
    {
      "id": "Doril",
      "group": 0
    },
    {
      "id": "Farit",
      "group": 0
    },
    {
      "id": "Hemin",
      "group": 0
    },
    {
      "id": "Jamunda",
```

For example, to find all the targets reachable by Hykanima, you can filter the `links` list using jq's `select()` method:

```sh
$ cat ./web/eve.json | jq '.links[] | select(.source == "Hykanima") | .target'
"FQ9W-C"
"O-BDXB"
"9-4RP2"
"6Z9-0M"
"F7C-H0"
"8R-RTB"
"6-4V20"
...
```

## Developing the visualization

To serve the static content for the visualization, use `npm run devserver` (you'll have to run `npm install` first to pick up the dev dependencies):

```sh
$ npm run devserver

> jumpmap@0.1.0 devserver ./jumpmap
> http-server ./web

Starting up http-server, serving ./web
Available on:
  http://127.0.0.1:8080
  http://192.168.1.171:8080
Hit CTRL-C to stop the server
```
