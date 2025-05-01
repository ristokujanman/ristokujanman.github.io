# Risto Kujanpää

## Adding a project

> edit `index.html`

> Within `div` with id `fullpage`, add the following template for a new project and follow instructions for each type:

```
<div class="section">

  <!-- 1. image -->
  <!-- replace YOUR_IMAGE -->
  <div class="slide">
    <img class="image" src="img/YOUR_IMAGE.jpg" />
  </div>

  <!-- 2. video -->
  <!-- replace YOUR_ID -->
  <div class="slide">
    <div class="embed">
      <div class="embed-container">
        <iframe src="https://player.vimeo.com/video/YOUR_ID?color=ffffff&portrait=0" frameborder="0" webkitallowfullscreen mozallowfullscreen allowfullscreen></iframe>
      </div>
    </div>
  </div>

  <!-- 3. text -->
  <!-- replace TITLE_TEXT, MAIN_TEXT -->
  <div class="slide">
    <div class="text">
      <h1>
        TITLE_TEXT
      </h1>
      <br/>
      <p>
        MAIN_TEXT
      </p>
    </div>
  </div>

</div>

```

> Now find the menu: `<ul id='menu'>'` and add a new list item for the section you just added.

> Replace `YOUR_ID` (leave the # in the second instance)

> Replace `YOUR_TITLE`

```
<li data-menuanchor="YOUR_ID" class="active">
  <a href="#YOUR_ID">Kiki</a>
</li>
```

> Last, but not least, find `$('#fullpage').fullpage({ ...` and add the same text as you just did in `YOUR_ID` to the anchors array.

```
anchors: ['kiki', 'putte', 'video', 'YOUR_ID', 'info', 'foot'],
```

> Save, refresh, check!
