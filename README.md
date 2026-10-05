# CVIG Lab website

The site for the Computer Vision, Imaging & Graphics Lab, IIT Gandhinagar, at <https://cviglab.github.io>.

GitHub Pages builds it with Jekyll every time you push to the publishing branch. There is no build step to run yourself. **To update the site, edit the text files listed below and push.**

## Where things live

| To change… | Edit | Notes |
|---|---|---|
| News | `_data/news.yml` | All items in one file; add new ones at the top. Text is Markdown. |
| Publications | `_data/publications.yml` | Add new papers at the top. Pasting the BibTeX is enough. |
| People, alumni | `_data/people.yml` | Groups, roles, fellowships, links, photos. |
| Research areas | `_data/research.yml` | Title, one line of text, optional figure. |
| Facts, courses, joining info, patents | `_data/site.yml` | |
| Site title, email, address | `_config.yml` | |
| Paper figures | `assets/teasers/` | Any JPEG/PNG. Record the source in `assets/teasers/SOURCES.md`. |
| Photos | `assets/people/` | 4:5 portrait, e.g. 400×500. |

### Add a news item

Add an entry at the top of `_data/news.yml`:

```yaml
- date: 2026-10-20
  tag: paper          # award | defense | paper | service | talk | event
  featured: true      # optional: highlight it
  image: rasp.jpg     # optional: a figure from assets/teasers/
  text: Our paper on **shadow-guided packing** is accepted at CVPR 2027. [Project page](https://example.org)
```

Items are sorted by date, and the home page shows the eight newest.

### Add a publication

Copy an existing entry in `_data/publications.yml` to the top of the file and edit it:

```yaml
- id: newpaper-cvpr27            # unique, lowercase
  title: "Paper title"
  short: "NewPaper"              # label shown on the figure placeholder
  authors: "**Lab Member**, External Author, **Shanmuganathan Raman**"   # **bold** = lab members
  venue: "CVPR 2027"
  venue_full: "IEEE/CVF Conference on Computer Vision and Pattern Recognition"
  year: 2027
  image: newpaper.jpg            # in assets/teasers/; leave blank for the colour-chart placeholder
  selected: true                 # optional: show on the home page
  highlight: true                # optional: show in the home-page highlight strip…
  summary: "One line for the highlight strip."   # …with this line
  links:
    project: https://…
    paper: https://…
    code: https://github.com/…
  bibtex: |
    @inproceedings{key2027,
      title = {…},
      …
    }
```

Link keys: `project`, `paper`, `code`, `video`, `slides`, `accepted` (a conference accepted-papers list). Links you leave out show as dimmed buttons (Paper, Code) or are hidden (the rest).

### Add a person

In `_data/people.yml`, under the right group:

```yaml
      - name: "New Student"
        role: "PhD, CSE, since 2026"
        topic: "Neural inverse rendering"      # optional
        photo: new-student.jpg                 # optional, in assets/people/
        fellowships: ["PMRF"]                  # optional, highlighted tags
        links: { scholar: https://…, github: https://…, website: https://…, linkedin: https://… }
```

To start a new group (e.g. alumni by year), add another `- title:` block under `groups:`.

## Preview locally (optional)

```sh
brew install ruby
gem install --user-install jekyll webrick
jekyll serve        # then open http://localhost:4000
```

## Code structure

- `_layouts/default.html`: the page shell. `_includes/`: the header, footer and components (publication entry, person, news feed, figure slot).
- `index.html`, `publications.html`, `people.html`: page templates that loop over the data files.
- `style.css`: the design system. `main.js`: nav, figure fallbacks, BibTeX copy, theme toggle and scroll reveals.
- `assets/js/hero3d.js`: the home-page header scene, 3D "CVIG" letters with a light circling them (steerable by pointer or arrow keys).
- `assets/js/cloud3d.js`: the morphing point cloud in the research section.
- Both scenes load Three.js from a CDN, pause when off screen, and respect reduced-motion settings.
