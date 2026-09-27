let DB = {
  companies: [],
  platforms: [],
  publications: [],
  reviewers: [],
  genres: [],
  games: [],
  reviews: []
};

const DB_BASE_URLS = {
  mobygames: "https://www.mobygames.com/game/",
  igdb: "https://www.igdb.com/games/",
  hltb: "https://howlongtobeat.com/game/"
};

document.addEventListener("DOMContentLoaded", async () => {
  await loadDatabase();
  populateFilterDropdowns();
  setupEventListeners();
  setupTabNavigation();
  renderStatistics();
  render();
});

async function loadDatabase() {
  try {
    const files = ["companies", "platforms", "publications", "reviewers", "genres", "games", "reviews"];
    const promises = files.map(file => fetch(`./data/${file}.json`).then(res => res.json()));
    const [companies, platforms, publications, reviewers, genres, games, reviews] = await Promise.all(promises);

    DB = {
      companies: companies.map(c => ({ ...c, id: Number(c.id) })),
      platforms: platforms.map(p => ({ ...p, id: Number(p.id) })),
      publications: publications.map(p => ({ ...p, id: Number(p.id) })),
      reviewers: reviewers.map(r => ({ ...r, id: Number(r.id) })),
      genres: genres.map(g => ({ ...g, id: Number(g.id) })),
      games: games.map(g => {
        const rawGenreIds = g.genre_ids || g.genres || (g.genre_id !== undefined ? [g.genre_id] : []);
        return {
          ...g,
          id: Number(g.id),
          platform_id: Number(g.platform_id),
          developer_ids: (g.developer_ids || []).map(Number),
          publisher_ids: (g.publisher_ids || []).map(Number),
          genre_ids: rawGenreIds.map(Number)
        };
      }),
      reviews: reviews.map(r => ({
        ...r,
        id: Number(r.id),
        game_id: Number(r.game_id),
        publication_ids: (r.publication_ids || []).map(Number),
        reviewer_ids: (r.reviewer_ids || []).map(Number)
      }))
    };
  } catch (err) {
    console.error("Failed to load Criticnomicon data:", err);
    document.getElementById("game-list").innerHTML = "<p>Failed to unseal archives.</p>";
  }
}

const getById = (arr) => new Map(arr.map(item => [Number(item.id), item]));

function getGlobalMeanScore() {
  if (!DB.reviews || DB.reviews.length === 0) return 75;
  const total = DB.reviews.reduce((acc, r) => acc + r.score, 0);
  return total / DB.reviews.length;
}

function getProcessedGames() {
  const companyMap = getById(DB.companies);
  const platformMap = getById(DB.platforms);
  const publicationMap = getById(DB.publications);
  const reviewerMap = getById(DB.reviewers);
  const genreMap = getById(DB.genres);

  const globalMean = getGlobalMeanScore();
  const minThreshold = 3;

  return DB.games.map(game => {
    const platform = platformMap.get(Number(game.platform_id));
    const developers = (game.developer_ids || []).map(id => companyMap.get(Number(id))).filter(Boolean);
    const publishers = (game.publisher_ids || []).map(id => companyMap.get(Number(id))).filter(Boolean);
    const genres = (game.genre_ids || []).map(id => genreMap.get(Number(id))).filter(Boolean);
    
    // Only developer countries are relevant
    const countries = Array.from(new Set(
      developers.flatMap(d => d.countries || [])
    ));

    let reviews = DB.reviews.filter(r => Number(r.game_id) === Number(game.id)).map(r => ({
      ...r,
      publications: (r.publication_ids || []).map(id => publicationMap.get(Number(id))).filter(Boolean),
      reviewers: (r.reviewer_ids || []).map(id => reviewerMap.get(Number(id))).filter(Boolean)
    }));

    // Sort reviews: Highest score first, then earliest published_date first
    reviews.sort((a, b) => {
    if (b.score !== a.score) {
        return b.score - a.score;
    }
    const dateA = a.published_date ? new Date(a.published_date).getTime() : (a.date ? new Date(a.date).getTime() : Infinity);
    const dateB = b.published_date ? new Date(b.published_date).getTime() : (b.date ? new Date(b.date).getTime() : Infinity);
    return dateA - dateB;
    });

    const v = reviews.length;
    let avgScore = null;
    let bayesianScore = null;

    if (v > 0) {
      const R = reviews.reduce((acc, r) => acc + r.score, 0) / v;
      avgScore = Math.round(R * 10) / 10;
      
      const bayesianRaw = (R * v + globalMean * minThreshold) / (v + minThreshold);
      bayesianScore = Math.round(bayesianRaw * 10) / 10;
    }

    return {
      ...game,
      platform,
      developers,
      publishers,
      genres,
      countries,
      reviews,
      avgScore,
      bayesianScore
    };
  });
}

function populateFilterDropdowns() {
  const populate = (elementId, items, labelKey = "name") => {
    const select = document.getElementById(elementId);
    select.innerHTML = select.options[0].outerHTML;
    items.forEach(item => {
      const opt = document.createElement("option");
      opt.value = item.id !== undefined ? Number(item.id) : item;
      opt.textContent = item[labelKey] || item;
      select.appendChild(opt);
    });
  };

  const processed = getProcessedGames();
  const allCountries = Array.from(new Set(processed.flatMap(g => g.countries))).sort();
  const allYears = Array.from(new Set(processed.flatMap(g => g.years))).sort((a, b) => a - b);

  const genreIds = new Set(processed.flatMap(g => g.genres.map(gen => gen.id)));
  const developerIds = new Set(processed.flatMap(g => g.developers.map(d => d.id)));
  const publisherIds = new Set(processed.flatMap(g => g.publishers.map(p => p.id)));
  const publicationIds = new Set(DB.reviews.flatMap(r => r.publication_ids || []).map(Number));

  const activeGenres = DB.genres
    .filter(g => genreIds.has(Number(g.id)))
    .sort((a, b) => a.name.localeCompare(b.name));

  const developers = DB.companies
    .filter(c => developerIds.has(Number(c.id)))
    .sort((a, b) => a.name.localeCompare(b.name));

  const publishers = DB.companies
    .filter(c => publisherIds.has(Number(c.id)))
    .sort((a, b) => a.name.localeCompare(b.name));

  const activePublications = DB.publications
    .filter(p => publicationIds.has(Number(p.id)))
    .sort((a, b) => a.name.localeCompare(b.name));

  populate("filter-genre", activeGenres);
  populate("filter-platform", DB.platforms);
  populate("filter-developer", developers);
  populate("filter-publisher", publishers);
  populate("filter-publication", activePublications);
  populate("filter-country", allCountries);
  
  const yearOptions = allYears.map(y => ({ id: y, name: y }));
  populate("filter-year-from", yearOptions);
  populate("filter-year-to", [...yearOptions].reverse());
}

function setupEventListeners() {
  const filters = [
    "filter-genre", "filter-platform", "filter-developer", 
    "filter-publisher", "filter-publication", "filter-country", 
    "filter-year-from", "filter-year-to", "sort-order", "toggle-bayesian"
  ];
  
  filters.forEach(id => {
    document.getElementById(id).addEventListener("change", () => {
      render();
    });
  });

  document.getElementById("reset-filters").addEventListener("click", () => {
    filters.forEach(id => {
      if (id !== "sort-order" && id !== "toggle-bayesian") {
        document.getElementById(id).value = "";
      }
    });
    document.getElementById("toggle-bayesian").checked = true;
    document.getElementById("sort-order").value = "score-desc";
    render();
  });
}

function setupTabNavigation() {
  const tabButtons = document.querySelectorAll(".nav-link");
  
  tabButtons.forEach(button => {
    button.addEventListener("click", () => {
      const targetTab = button.getAttribute("data-tab");

      tabButtons.forEach(btn => btn.classList.remove("active"));
      button.classList.add("active");

      document.querySelectorAll(".view-section").forEach(view => {
        view.classList.remove("active");
        view.style.display = "none";
      });

      const activeView = document.getElementById(`${targetTab}-view`);
      if (activeView) {
        activeView.classList.add("active");
        activeView.style.display = targetTab === "archive" ? "grid" : "block";
      }
    });
  });
}

function toggleStatExpansion(button) {
  const container = button.parentElement;
  const hiddenRows = container.querySelectorAll(".stat-row-hidden");
  const isExpanded = button.getAttribute("data-expanded") === "true";

  if (isExpanded) {
    hiddenRows.forEach(row => row.style.display = "none");
    button.textContent = `Show All (${container.getAttribute("data-total-count")})`;
    button.setAttribute("data-expanded", "false");
  } else {
    hiddenRows.forEach(row => row.style.display = "table-row");
    button.textContent = "Show Top 10";
    button.setAttribute("data-expanded", "true");
  }
}

function getExternalLinksHtml(game) {
  const links = [];

  if (game.mobygames_id) {
    links.push(`
      <a href="${DB_BASE_URLS.mobygames}${game.mobygames_id}" target="_blank" rel="noopener" class="external-link link-moby" onclick="event.stopPropagation()">
        MobyGames
      </a>
    `);
  }

  if (game.igdb_id) {
    links.push(`
      <a href="${DB_BASE_URLS.igdb}${game.igdb_id}" target="_blank" rel="noopener" class="external-link link-igdb" onclick="event.stopPropagation()">
        IGDB
      </a>
    `);
  }

  if (game.hltb_id) {
    links.push(`
      <a href="${DB_BASE_URLS.hltb}${game.hltb_id}" target="_blank" rel="noopener" class="external-link link-hltb" onclick="event.stopPropagation()">
        HLTB
      </a>
    `);
  }

  if (links.length === 0) return "";

  return `
    <div class="external-links">
      <strong>Database Links:</strong> ${links.join(" • ")}
    </div>
  `;
}

function renderStatistics() {
  const games = getProcessedGames();
  
  const totalGames = games.length;
  const totalReviews = DB.reviews.length;
  const globalMean = getGlobalMeanScore();

  document.getElementById("stat-total-games").textContent = totalGames;
  document.getElementById("stat-total-reviews").textContent = totalReviews;
  document.getElementById("stat-overall-avg").textContent = globalMean ? globalMean.toFixed(1) : "N/A";

  const buildTable = (dataArray, nameHeader = "Name") => {
    if (!dataArray || dataArray.length === 0) return "<p>No data</p>";
    
    // Primary sort: Average Score (descending), Secondary sort: Count (descending)
    dataArray.sort((a, b) => {
      const scoreA = a.avg !== null ? a.avg : -Infinity;
      const scoreB = b.avg !== null ? b.avg : -Infinity;
      return scoreB - scoreA || b.count - a.count;
    });

    // Calculate rank handling tied scores
    let currentRank = 1;
    dataArray.forEach((item, index) => {
      if (index > 0) {
        const prevItem = dataArray[index - 1];
        if (item.avg !== prevItem.avg) {
          currentRank = index + 1;
        }
      }
      item.rank = currentRank;
    });

    const totalItems = dataArray.length;
    const hasMoreThan10 = totalItems > 10;

    return `
      <div class="stat-table-wrapper" data-total-count="${totalItems}">
        <table class="stats-table">
          <thead>
            <tr>
              <th>Rank</th>
              <th style="text-align: left;">${nameHeader}</th>
              <th>Avg Score</th>
              <th>Count</th>
            </tr>
          </thead>
          <tbody>
            ${dataArray.map((item, index) => {
              const isHidden = index >= 10;
              return `
                <tr class="${isHidden ? 'stat-row-hidden' : ''}" style="${isHidden ? 'display: none;' : ''}">
                  <td><strong>${item.rank}.</strong></td>
                  <td style="text-align: left;">${item.name}</td>
                  <td><strong>${item.avg !== null ? item.avg : 'N/A'}</strong></td>
                  <td>${item.count}</td>
                </tr>
              `;
            }).join("")}
          </tbody>
        </table>
        ${hasMoreThan10 ? `
          <button class="btn-stat-toggle" data-expanded="false" onclick="toggleStatExpansion(this)" style="margin-top: 8px; width: 100%; padding: 6px; cursor: pointer;">
            Show All (${totalItems})
          </button>
        ` : ""}
      </div>
    `;
  };

  const aggregateCompanyStats = (getCompaniesFn) => {
    const statsMap = new Map();
    games.forEach(g => {
      const companies = getCompaniesFn(g);
      companies.forEach(c => {
        if (!statsMap.has(c.id)) {
          statsMap.set(c.id, { name: c.name, scores: [], gameIds: new Set() });
        }
        const entry = statsMap.get(c.id);
        entry.gameIds.add(g.id);
        if (g.avgScore !== null) entry.scores.push(...g.reviews.map(r => r.score));
      });
    });

    return Array.from(statsMap.values()).map(e => ({
      name: e.name,
      count: e.gameIds.size,
      avg: e.scores.length ? Math.round((e.scores.reduce((a, b) => a + b, 0) / e.scores.length) * 10) / 10 : null
    }));
  };

  const devData = aggregateCompanyStats(g => g.developers);
  const pubCompanyData = aggregateCompanyStats(g => g.publishers);

  // --- Aggregate Genres ---
  const genreStats = new Map();
  games.forEach(g => {
    g.genres.forEach(gen => {
      if (!genreStats.has(gen.id)) {
        genreStats.set(gen.id, { name: gen.name, scores: [], gameIds: new Set() });
      }
      const entry = genreStats.get(gen.id);
      entry.gameIds.add(g.id);
      if (g.avgScore !== null) entry.scores.push(...g.reviews.map(r => r.score));
    });
  });

  const genreData = Array.from(genreStats.values()).map(e => ({
    name: e.name,
    count: e.gameIds.size,
    avg: e.scores.length ? Math.round((e.scores.reduce((a, b) => a + b, 0) / e.scores.length) * 10) / 10 : null
  }));

  // --- Aggregate Developer Countries ---
  const countryStats = new Map();
  games.forEach(g => {
    g.countries.forEach(country => {
      if (!countryStats.has(country)) {
        countryStats.set(country, { name: country, scores: [], gameIds: new Set() });
      }
      const entry = countryStats.get(country);
      entry.gameIds.add(g.id);
      if (g.avgScore !== null) entry.scores.push(...g.reviews.map(r => r.score));
    });
  });

  const countryData = Array.from(countryStats.values()).map(e => ({
    name: e.name,
    count: e.gameIds.size,
    avg: e.scores.length ? Math.round((e.scores.reduce((a, b) => a + b, 0) / e.scores.length) * 10) / 10 : null
  }));

  // --- Aggregate Platforms ---
  const platformStats = new Map();
  games.forEach(g => {
    if (!g.platform) return;
    if (!platformStats.has(g.platform.id)) {
      platformStats.set(g.platform.id, { name: g.platform.name, scores: [], gameIds: new Set() });
    }
    const entry = platformStats.get(g.platform.id);
    entry.gameIds.add(g.id);
    if (g.avgScore !== null) entry.scores.push(...g.reviews.map(r => r.score));
  });

  const platformData = Array.from(platformStats.values()).map(e => ({
    name: e.name,
    count: e.gameIds.size,
    avg: e.scores.length ? Math.round((e.scores.reduce((a, b) => a + b, 0) / e.scores.length) * 10) / 10 : null
  }));

  // --- Aggregate Publications ---
  const pubStats = new Map();
  games.forEach(g => {
    g.reviews.forEach(r => {
      r.publications.forEach(p => {
        if (!pubStats.has(p.id)) {
          pubStats.set(p.id, { name: p.name, scores: [] });
        }
        pubStats.get(p.id).scores.push(r.score);
      });
    });
  });

  const pubData = Array.from(pubStats.values()).map(e => ({
    name: e.name,
    count: e.scores.length,
    avg: e.scores.length ? Math.round((e.scores.reduce((a, b) => a + b, 0) / e.scores.length) * 10) / 10 : null
  }));

  // --- Aggregate Reviewers ---
  const reviewerStats = new Map();
  games.forEach(g => {
    g.reviews.forEach(r => {
      r.reviewers.forEach(rev => {
        if (!reviewerStats.has(rev.id)) {
          reviewerStats.set(rev.id, { name: rev.name, scores: [] });
        }
        reviewerStats.get(rev.id).scores.push(r.score);
      });
    });
  });

  const reviewerData = Array.from(reviewerStats.values()).map(e => ({
    name: e.name,
    count: e.scores.length,
    avg: e.scores.length ? Math.round((e.scores.reduce((a, b) => a + b, 0) / e.scores.length) * 10) / 10 : null
  }));

  document.getElementById("stats-developers").innerHTML = buildTable(devData, "Developer");
  document.getElementById("stats-publishers").innerHTML = buildTable(pubCompanyData, "Publisher");
  document.getElementById("stats-genres").innerHTML = buildTable(genreData, "Genre");
  
  const countryEl = document.getElementById("stats-countries");
  if (countryEl) countryEl.innerHTML = buildTable(countryData, "Country");

  document.getElementById("stats-platforms").innerHTML = buildTable(platformData, "Platform");
  document.getElementById("stats-publications").innerHTML = buildTable(pubData, "Publication");
  document.getElementById("stats-reviewers").innerHTML = buildTable(reviewerData, "Reviewer");
}

function calculateRankMap(gamesSortedByScore, getScoreFn) {
  const rankMap = new Map();
  let currentRank = 1;

  gamesSortedByScore.forEach((game, index) => {
    if (index > 0) {
      const prevGame = gamesSortedByScore[index - 1];
      if (getScoreFn(game) !== getScoreFn(prevGame)) {
        currentRank = index + 1;
      }
    }
    rankMap.set(game.id, currentRank);
  });

  return rankMap;
}

function render() {
  const allGames = getProcessedGames();
  const useBayesian = document.getElementById("toggle-bayesian").checked;

  const getScore = (game) => {
    const score = useBayesian ? game.bayesianScore : game.avgScore;
    return score !== null && score !== undefined ? score : -Infinity;
  };

  const globalSorted = [...allGames].sort((a, b) => getScore(b) - getScore(a));
  const globalRankMap = calculateRankMap(globalSorted, getScore);

  const genreFilter = document.getElementById("filter-genre").value ? Number(document.getElementById("filter-genre").value) : null;
  const platFilter = document.getElementById("filter-platform").value ? Number(document.getElementById("filter-platform").value) : null;
  const devFilter = document.getElementById("filter-developer").value ? Number(document.getElementById("filter-developer").value) : null;
  const pubFilter = document.getElementById("filter-publisher").value ? Number(document.getElementById("filter-publisher").value) : null;
  const publicationFilter = document.getElementById("filter-publication").value ? Number(document.getElementById("filter-publication").value) : null;
  const countryFilter = document.getElementById("filter-country").value;
  const yearFromFilter = document.getElementById("filter-year-from").value ? Number(document.getElementById("filter-year-from").value) : null;
  const yearToFilter = document.getElementById("filter-year-to").value ? Number(document.getElementById("filter-year-to").value) : null;
  const sortOrder = document.getElementById("sort-order").value;

  const isFiltered = Boolean(
    genreFilter !== null || platFilter !== null || devFilter !== null || pubFilter !== null || 
    publicationFilter !== null || countryFilter || yearFromFilter !== null || yearToFilter !== null
  );

  let filteredGames = allGames.filter(game => {
    if (genreFilter !== null && !game.genres.some(g => Number(g.id) === genreFilter)) return false;
    if (platFilter !== null && Number(game.platform_id) !== platFilter) return false;
    if (devFilter !== null && !game.developers.some(d => Number(d.id) === devFilter)) return false;
    if (pubFilter !== null && !game.publishers.some(p => Number(p.id) === pubFilter)) return false;
    
    if (publicationFilter !== null) {
      const hasPub = game.reviews.some(r => 
        (r.publication_ids || []).some(id => Number(id) === publicationFilter) ||
        (r.publications || []).some(p => Number(p.id) === publicationFilter)
      );
      if (!hasPub) return false;
    }

    if (countryFilter && !game.countries.includes(countryFilter)) return false;

    if (yearFromFilter !== null || yearToFilter !== null) {
      const minYear = yearFromFilter !== null ? yearFromFilter : -Infinity;
      const maxYear = yearToFilter !== null ? yearToFilter : Infinity;
      const inRange = (game.years || []).some(y => y >= minYear && y <= maxYear);
      if (!inRange) return false;
    }

    return true;
  });

  const filteredScoreSorted = [...filteredGames].sort((a, b) => getScore(b) - getScore(a));
  const filteredRankMap = calculateRankMap(filteredScoreSorted, getScore);

  filteredGames.sort((a, b) => {
    if (sortOrder === "score-desc") return getScore(b) - getScore(a);
    if (sortOrder === "score-asc") return getScore(a) - getScore(b);
    if (sortOrder === "title-asc") return a.title.localeCompare(b.title);
    if (sortOrder === "reviews-desc") return b.reviews.length - a.reviews.length;
    return 0;
  });

  document.getElementById("game-count").textContent = `Displaying ${filteredGames.length} archive entries`;

  const listEl = document.getElementById("game-list");
  if (filteredGames.length === 0) {
    listEl.innerHTML = "<p>No entries match the selected filters.</p>";
    return;
  }

  listEl.innerHTML = filteredGames.map(game => {
    const globalRank = globalRankMap.get(game.id);
    const filteredRank = filteredRankMap.get(game.id);
    const displayScore = useBayesian ? game.bayesianScore : game.avgScore;

    return `
      <article class="game-card" onclick="this.classList.toggle('open')">
        <div class="card-summary">
          <div class="rank-badges">
            <span class="badge-rank badge-global" title="Global Rank: ${globalRank}.">${globalRank}.</span>
            ${isFiltered ? `<span class="badge-rank badge-filtered" title="Filtered Rank: ${filteredRank}.">${filteredRank}.</span>` : ""}
          </div>

          <div class="card-main-info">
            <div class="title-row">
              <span class="game-title">${game.title}</span>
              <span class="game-year">(${game.years.join(", ")})</span>
            </div>
            <div class="meta-tags">
              <span class="tag tag-platform">${game.platform ? game.platform.name : "Unknown"}</span>
              ${game.genres.length > 0 ? game.genres.map(g => `<span class="tag tag-genre">${g.name}</span>`).join("") : ""}
            </div>
          </div>

          <div class="score-pill" title="${useBayesian ? 'Bayesian Weighted Score' : 'Raw Average Score'}: ${displayScore !== null ? displayScore : 'N/A'}">
            ${displayScore !== null ? displayScore : "N/A"}
          </div>
        </div>

        <div class="card-details">
          <div class="details-grid">
            <div><strong>Developers:</strong> ${game.developers.map(d => d.name).join(", ") || "Unknown"}</div>
            <div><strong>Publishers:</strong> ${game.publishers.map(p => p.name).join(", ") || "Unknown"}</div>
            <div><strong>Genres:</strong> ${game.genres.map(g => g.name).join(", ") || "N/A"}</div>
            <div><strong>Countries:</strong> ${game.countries.join(", ") || "N/A"}</div>
            <div><strong>Bayesian Score:</strong> ${game.bayesianScore !== null ? game.bayesianScore : "N/A"} / 100</div>
            <div><strong>Raw Review Average:</strong> ${game.avgScore !== null ? game.avgScore : "N/A"} / 100</div>
          </div>

          ${getExternalLinksHtml(game)}

          <div class="reviews-header">Recorded Reviews (${game.reviews.length})</div>
          <div class="reviews-list">
            ${game.reviews.map(r => `
              <div class="review-item">
                <span>
                  <a href="${r.url}" target="_blank" rel="noopener" class="review-link" onclick="event.stopPropagation()">
                    ${r.publications.map(p => p.name).join(", ")}
                  </a> 
                  by ${r.reviewers.map(rev => rev.name).join(", ")} 
                  <small style="color:var(--text-muted)">(issue: ${r.issue}${r.published_date ? ` • published: ${r.published_date}` : ''})</small>
                </span>
                <strong>${r.original_score_display}</strong>
              </div>
            `).join("")}
          </div>
        </div>
      </article>
    `;
  }).join("");
}