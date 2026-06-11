---
layout: default
title: Blog
description: Founder essays, tutorials, and engineering deep-dives from the makers of Komi Store.
keywords: komi store, github store blog, komi store, github store news, komi store, github store updates, kotlin multiplatform blog, app store engineering, indie open source
permalink: /blog/
redirect_from:
  - /news/
---

<section class="page-hero container">
    <div class="page-hero__inner">
        <p class="section-header__overline">Blog</p>
        <h1 class="page-hero__title">Notes from the build</h1>
        <p class="page-hero__subtitle">Founder essays, position posts, and engineering deep-dives from the makers of Komi Store.</p>
        <div class="page-hero__actions">
            <a href="/blog/feed.xml" class="btn btn--tonal">
                <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6.18 15.64a2.18 2.18 0 0 1 2.18 2.18C8.36 19 7.38 20 6.18 20C5 20 4 19 4 17.82a2.18 2.18 0 0 1 2.18-2.18M4 4.44A15.56 15.56 0 0 1 19.56 20h-2.83A12.73 12.73 0 0 0 4 7.27V4.44m0 5.66a9.9 9.9 0 0 1 9.9 9.9h-2.83A7.07 7.07 0 0 0 4 12.93V10.1Z"/></svg>
                Subscribe via RSS
            </a>
        </div>
    </div>
</section>

<section class="news-list container">
    <div class="blog-newsletter">
        {% include newsletter.html id="blog-hero" title="Get the next post" subtitle="One email every 2 weeks. Founder notes, engineering deep-dives, and major release breakdowns." %}
    </div>

    <ul class="news-list__items">
        {% assign posts = site.news | sort: "date" | reverse %}
        {% for post in posts %}
        <li class="news-list__item">
            <time datetime="{{ post.date | date_to_xmlschema }}">
                {{ post.date | date: "%B %-d, %Y" }}
            </time>
            <a href="{{ post.url }}" class="news-list__title">{{ post.title }}</a>
            {% if post.description %}
                <p class="news-list__excerpt">{{ post.description }}</p>
            {% endif %}
            {% if post.tags %}
            <p class="news-list__tags">
                {% for tag in post.tags %}
                <span class="news-list__tag">{{ tag }}</span>
                {% endfor %}
            </p>
            {% endif %}
        </li>
        {% endfor %}
    </ul>
</section>
