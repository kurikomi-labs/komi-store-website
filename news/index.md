---
layout: default
title: News
description: Founder essays, comparison guides, tutorials, and engineering deep-dives from the makers of GitHub Store.
keywords: github store news, github store blog, github store updates, kotlin multiplatform blog, app store engineering
permalink: /news/
---

<section class="news-list container">
    <header class="news-list__header">
        <h1>News</h1>
        <p class="news-list__sub">Updates, position posts, and release notes.</p>
        <a href="/news/feed.xml" class="news-list__rss">RSS</a>
    </header>

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
