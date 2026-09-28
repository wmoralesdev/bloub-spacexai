/**
 * Locale de reference. Les deux autres sont typees `typeof fr`, donc c'est ce
 * fichier qui definit le contrat : y ajouter une cle fait echouer `vue-tsc` sur
 * `en.ts` et `zh.ts` jusqu'a ce qu'elles soient traduites.
 *
 * Surtout PAS de `as const` : chaque valeur deviendrait son propre type
 * litteral, et toute traduction serait alors refusee comme n'etant pas la
 * chaine francaise.
 *
 * Les guillemets et les espaces font partie de la traduction, pas du code : le
 * francais veut « ... » avec espaces insecables, l'anglais "...", le chinois
 * n'a pas d'espace avant ses unites. Aucun composant ne doit les ajouter.
 */
export default {
  app: {
    /**
     * Nom du produit. En minuscules dans les trois langues, ce n'est pas une
     * coquille : les capitales de `NOM` (App.vue) sont un logotype, pas le nom.
     * Un nom propre ne se traduit pas non plus. `title` sert de `document.title`.
     * Voir aussi le <title> de index.html, qui est statique.
     */
    name: 'bloub',
    title: 'bloub — avatar SVG animé',
    botAria: 'Avatar bloub animé'
  },

  gallery: {
    back: 'Retour au lecteur'
  },

  rail: {
    speakers: "Intervenants",
    nav: 'Sections',
    customize: 'Personnaliser',
    stills: 'Figés',
    botCards: 'Cartes de bots',
    animations: 'Animations',
    settings: 'Réglages'
  },

  botCards: {
    title: 'Cartes de bots',
    description: 'Créez une carte carrée pour votre bot.',
    newCard: 'Nouvelle carte',
    savedCards: 'Vos cartes',
    untitled: 'Carte sans nom',
    emptyTitle: 'Créez votre première carte de bot',
    emptyDescription: 'Ajoutez un nom, un identifiant et une description, puis personnalisez le bot.',
    name: 'Nom',
    handle: 'Identifiant',
    body: 'Description',
    namePlaceholder: 'Robots de la maison',
    handlePlaceholder: '@votrenom',
    bodyPlaceholder: 'Que peut faire votre bot ?',
    side: 'Face de la carte',
    front: 'Recto',
    back: 'Verso',
    eventName: 'Nom de l’événement (facultatif)',
    eventNamePlaceholder: 'Votre événement',
    eventNameHelp: 'Apparaît au recto avec les bots. Appuyez sur Entrée pour ajouter un saut de ligne.',
    link: 'Lien du bot',
    linkPlaceholder: 'https://x.ai/bot/…',
    linkHelp: 'Ajoutez le lien du bot pour générer un code QR au verso.',
    linkRequired: 'Ajoutez un lien pour exporter le verso avec son code QR.',
    linkInvalid: 'Saisissez un lien http:// ou https:// valide, de 1 200 caractères encodés maximum.',
    previewSideAria: '{side} de la carte du bot {name}',
    exportSide: 'Face exportée : {side}',
    customizeBot: 'Personnaliser le bot',
    customColor: 'Couleur personnalisée',
    usePalette: 'Utiliser la couleur de la palette',
    previewAria: 'Carte du bot {name}',
    previewNote: 'Aperçu statique',
    squareExport: '2000 × 2000 px · Carré',
    downloadPng: 'Télécharger le PNG',
    downloadSvg: 'Télécharger le SVG',
    downloadPdf: 'Télécharger le PDF CMJN',
    downloadAllPng: 'Tous les PNG (ZIP)',
    downloadAllSvg: 'Tous les SVG (ZIP)',
    downloadAllPdf: 'Toutes les cartes · PDF CMJN',
    printSize: 'Taille de la carte (cm)',
    printHelp: 'PDF carré à taille réelle, avec le profil CMJN SWOP. L’aperçu à l’écran reste en RVB.',
    invalidPrintSize: 'Saisissez une taille de carte comprise entre 1 et 30 cm.',
    batchHelp: 'Le recto et le verso de chaque carte dans un seul ZIP.',
    batchProgress: 'Préparation de {completed} fichiers sur {total}…',
    batchDownloaded: 'ZIP téléchargé',
    batchError: 'Le ZIP n’a pas pu être exporté. Réessayez.',
    batchNameRequired: 'Ajoutez un nom à la carte {n} pour exporter toutes les cartes.',
    batchLinkRequired: 'Ajoutez un lien valide à la carte {n} pour exporter les deux faces de toutes les cartes.',
    exporting: 'Préparation…',
    downloaded: 'Carte téléchargée',
    exportError: 'La carte n’a pas pu être exportée. Réessayez.',
    previewError: 'L’aperçu n’a pas pu être affiché. Réessayez.',
    nameRequired: 'Saisissez le nom de votre bot.',
    deleteCard: 'Supprimer la carte',
    deleteConfirm: 'Supprimer cette carte ? Cette action est irréversible.',
    cancel: 'Annuler',
    confirmDelete: 'Supprimer',
    saving: 'Enregistrement…',
    savedLocally: 'Enregistré dans ce navigateur',
    saveError: 'Impossible d’enregistrer dans ce navigateur. Vos modifications restent disponibles dans cet onglet.',
    retrySave: 'Réessayer d’enregistrer',
    limitReached: 'Vous pouvez enregistrer jusqu’à {n} cartes.',
    duplicate: 'Dupliquer',
    readError: 'Impossible de charger les cartes enregistrées. Vous pouvez continuer à modifier dans cet onglet.'
  },

  printExport: {
    format: 'Format d’export',
    rgb: 'SVG (RVB)',
    cmyk: 'PDF (CMJN)',
    help: 'Le visuel CMJN utilise le profil SWOP. Les tracés de découpe restent dans un SVG séparé aux mêmes dimensions physiques. L’aperçu à l’écran reste en RVB.',
    unavailable: 'L’export CMJN est indisponible. Démarrez le service de rendu local avec Chrome et Ghostscript installés.',
    busy: 'Un autre export pour impression est en cours. Réessayez dans un instant.',
    failed: 'Le PDF CMJN n’a pas pu être préparé. Réessayez.',
    invalid: 'Le visuel ou les dimensions d’impression n’ont pas pu être exportés.'
  },

  speakers: {
    title: "Intervenants",
    description: "Créez le visuel du prochain intervenant Grok Bot.",
    savedSpeakers: "Intervenants enregistrés",
    variant: "Variante de l’intervenant",
    newVariant: "Nouvel intervenant",
    duplicateVariant: "Dupliquer",
    removeVariant: "Supprimer la variante",
    removeConfirm: "Supprimer cette variante enregistrée ? Cette action est irréversible.",
    cancel: "Annuler",
    confirmRemove: "Supprimer",
    unnamedVariant: "Intervenant sans nom",
    saving: "Enregistrement…",
    savedLocally: "Enregistré dans ce navigateur",
    saveError: "Impossible d’enregistrer dans ce navigateur. Vos modifications restent disponibles dans cet onglet.",
    storageReadError: "Impossible de charger les variantes enregistrées. Vous pouvez continuer à modifier le visuel dans cet onglet.",
    retrySave: "Réessayer d’enregistrer",
    availablePhotos: "Photos disponibles",
    choosePhoto: "Utiliser la photo de {name}",
    preparingPhoto: "Préparation de la photo…",
    exportFormat: "Format d’export",
    download: "Télécharger",
    downloadAll: "Tous les intervenants · {format} (ZIP)",
    batchHelp: "Tous les intervenants + affiche collective · 4:3, 1:1 et 9:16 · {total} fichiers {format}",
    artworkView: "Type de visuel",
    individualArtwork: "Visuels individuels",
    lineupTitle: "Intervenants et conférences",
    lineupDescription: "Un visuel avec tous les intervenants enregistrés et le titre de leur conférence. Les modifications des visuels individuels sont reprises automatiquement.",
    lineupPreviewAria: "Tous les intervenants et titres des conférences de {event}, au format {aspect}",
    lineupMissingTitles: "{count} intervenants n’ont pas encore de titre de conférence. Seul leur nom sera affiché.",
    lineupEdit: "Modifier {name}",
    lineupEmpty: "Ajoutez un intervenant pour créer l’affiche collective.",
    batchProgress: "Préparation de {completed} fichiers sur {total}… {progress} %",
    batchDownloaded: "ZIP des intervenants téléchargé",
    batchError: "Le ZIP des intervenants n’a pas pu être exporté. Réessayez.",
    batchNameRequired: "Ajoutez un nom à l’intervenant {n} pour tous les exporter.",
    exporting: "Préparation…",
    aspectRatio: "Proportions",
    previewAria: "Visuel promotionnel de {name}, {event}, au format {aspect}{talkTitle}",
    previewNote: "Aperçu en direct",
    animatedNote: "Boucle neutre de 6 secondes · Sans son",
    mp4LoopNote: "Activez la répétition dans votre lecteur vidéo pour une lecture en continu.",
    gifLoopNote: "Le GIF se répète en continu.",
    playPreview: "Lire l’aperçu",
    pausePreview: "Mettre l’aperçu en pause",
    animationLoading: "Chargement de l’animation…",
    animationError: "L’animation n’a pas pu être chargée. Réessayez.",
    renderProgress: "Rendu en cours… {progress} %",
    cancelExport: "Annuler l’export",
    exportCancelled: "Export annulé",
    renderUnavailable: "Le service de rendu est indisponible. Réessayez lorsqu’il sera démarré.",
    renderBusy: "Un autre export est en cours. Réessayez une fois terminé.",
    retryExport: "Réessayer l’export",
    exportQuality: "Export en haute résolution",
    loading: "Chargement du visuel…",
    downloaded: "Fichier téléchargé",
    exportError: "Le fichier n’a pas pu être exporté. Réessayez.",
    retry: "Réessayer",
    photo: "Photo",
    photoAlt: "Portrait de l’intervenant sélectionné",
    samplePhoto: "Walter Morales · exemple",
    photoLoading: "Chargement de la photo…",
    replacePhoto: "Changer de photo",
    photoHelp: "PNG ou WebP avec le fond déjà supprimé. Jusqu’à 20 Mo.",
    restoreSample: "Utiliser la photo d’exemple",
    speakerDetails: "Intervenant",
    talkTitle: "Titre de la conférence",
    talkTitlePlaceholder: "Que souhaitez-vous partager ?",
    name: "Nom",
    nameRequired: "Saisissez le nom de l’intervenant.",
    label: "Type de participation",
    role: "Fonction / organisation",
    eventDetails: "Événement",
    event: "Événement",
    city: "Ville / rencontre",
    date: "Date",
    time: "Horaire",
    venue: "Lieu",
    url: "Lien",
    optional: "Facultatif",
    composition: "Composition",
    portrait: "Portrait",
    resetComposition: "Réinitialiser",
    horizontal: "Position horizontale",
    vertical: "Position verticale",
    size: "Taille",
    fade: "Fondu diagonal",
    showBots: "Afficher les Grok bots",
    botSize: "Taille du groupe",
    sampleError: "La photo d’exemple n’a pas pu être chargée. Réessayez ou choisissez une photo.",
    photoError: "Cette image n’a pas pu être ouverte. Choisissez un autre PNG ou WebP.",
    photoTypeError: "Choisissez une image PNG ou WebP.",
    photoSizeError: "Cette image est trop volumineuse. Choisissez un fichier de moins de 20 Mo.",
    artworkError: "Les Grok bots n’ont pas pu être chargés.",
    previewError: "L’aperçu n’a pas pu être affiché. Réessayez."
  },

  panel: {
    /**
     * Au SINGULIER, comme les trois autres : un titre de grille nomme ce qu'un
     * clic pose, pas le nombre de vignettes proposees. Le pluriel reste au rail,
     * qui nomme la vue et non le choix (`rail.animations`).
     */
    animations: 'Animation',
    shape: 'Forme',
    expression: 'Expression',
    color: 'Couleur'
  },

  /**
   * Barre d'export de la vue Personnaliser. Les libelles du menu sont des
   * ACTIONS et pas des noms de format : « Télécharger le PNG » se comprend sans
   * savoir ce qu'est un PNG, « PNG · 1024 px » demande de trancher une question
   * qui n'est pas celle de l'utilisateur.
   */
  export: {
    action: 'Exporter en PNG',
    more: 'Autres formats',
    png: 'Télécharger le PNG',
    svg: 'Télécharger le SVG',
    anime: "Télécharger l'animation SVG",
    gif: 'Télécharger le GIF animé',
    cycleDetail: 'La vidéo est plus légère et plus fluide ; le GIF passe partout.',
    cycleFormat: 'Format',
    cycle_mp4: 'Vidéo MP4',
    cycle_mp4_aide: 'Léger et fluide, fond obligatoire',
    cycle_gif: 'GIF animé',
    cycle_gif_aide: 'Lu partout, plus lourd',
    cycleProgress: 'Export en cours…',
    cycleReessayer: 'Réessayer',
    gifTitle: 'Télécharger le GIF animé',
    gifDetail:
      "Le GIF ne gère la transparence qu'en tout ou rien : sans fond, le contour de la boule est un peu dur.",
    gifBackground: 'Fond',
    fond_blanc: 'Fond blanc',
    fond_blanc_aide: 'Contour lisse, à poser sur du clair',
    fond_transparent: 'Fond transparent',
    fond_transparent_aide: "S'adapte à tout fond, contour un peu dur",
    gifConfirm: 'Télécharger',
    copie: "Copier l'image",
    copieSvg: 'Copier le SVG',
    zip: 'Télécharger les PNG',
    zipSvg: 'Télécharger les SVG',
    done: 'Exporté',
    copied: 'Copié',
    failed: "Échec de l'export"
  },

  figes: {
    add: 'Ajouter',
    unselect: 'Désélectionner',
    undo: 'Annuler',
    empty: 'Ajoutez un portrait figé pour l’exporter.',
    selectAria: 'Modifier {shape}, {expression}, {color}',
    removeAria: 'Retirer {shape}, {expression}, {color}'
  },

  stickerSheet: {
    selectAll: 'Tout sélectionner',
    clearSelection: 'Vider la sélection',
    selectedCount: '{count} sélectionnés',
    includeAria: 'Inclure {shape}, {expression}, {color} dans la planche de stickers',
    createSheet: 'Créer une planche',
    title: 'Planche de stickers',
    description: 'Téléchargez le visuel et les tracés vectoriels de découpe alignés de vos stickers sélectionnés.',
    sheetSize: 'Format de la planche',
    width: 'Largeur (cm)',
    height: 'Hauteur (cm)',
    presetA4: 'A4',
    presetLetter: 'Lettre',
    presetHalfLetter: 'Demi-lettre',
    presetQuarterLetter: '¼ Lettre',
    presetCustom: 'Personnalisé',
    swapOrientation: 'Changer l’orientation',
    backgroundColor: 'Couleur de la planche',
    backgroundColorHex: 'Couleur de la planche en hexadécimal',
    brandingTitle: 'Identité de la planche',
    uploadBranding: 'Importer un visuel de marque',
    replaceBranding: 'Remplacer le visuel',
    removeBranding: 'Retirer le visuel',
    brandingHelp: 'Logo SVG jusqu’à 256 Ko, avec le texte converti en tracés. Ajouté comme sticker découpé selon sa silhouette.',
    brandingError: 'Utilisez un SVG autonome de moins de 256 Ko, avec le texte converti en tracés et sans images liées.',
    invalidBrandingGeometry: 'Le logo ne permet pas de former un contour unique. Essayez une bordure blanche plus large ou un SVG plus simple sur fond transparent.',
    brandingLoading: 'Chargement du visuel…',
    brandingAdjust: 'Taille et position du logo',
    brandingSize: 'Taille du logo (cm)',
    brandingX: 'Centre X (cm)',
    brandingY: 'Centre Y (cm)',
    brandingPositionHelp: 'Déplacez le logo dans l’aperçu, utilisez les touches fléchées ou saisissez la position de son centre depuis le coin supérieur gauche de la planche.',
    brandingSizeHelp: 'Le plus grand côté, bordure blanche comprise. Les proportions du logo sont conservées.',
    brandingReset: 'Réinitialiser le logo',
    brandingDrag: 'Déplacer le logo',
    brandingOutside: 'Le logo dépasse la marge de la planche. Déplacez-le vers l’intérieur ou réduisez sa taille avant de télécharger.',
    brandingNoSpace: 'Il manque de la place à côté du logo. Déplacez-le vers la droite, réduisez sa taille ou réduisez la taille des stickers ou leur espacement.',
    invalidBrandingPlacement: 'Saisissez une taille de logo valide supérieure au double de la bordure blanche et des coordonnées finies pour son centre.',
    stickerSize: 'Taille du sticker (cm)',
    autoFit: 'Ajuster automatiquement les stickers',
    autoFitHelp: 'Ajustez tous les stickers sélectionnés à la plus grande taille possible, en conservant l’espacement et les marges.',
    stickerSizeHelp: 'Le plus grand côté du sticker fini, bordure blanche comprise.',
    border: 'Bordure blanche (mm)',
    gap: 'Espacement (mm)',
    margin: 'Marge de la planche (mm)',
    preview: 'Aperçu de la planche',
    art: 'Visuel',
    cut: 'Découpe',
    overlay: 'Superposition',
    previewAria: 'Planche de stickers : {mode}',
    capacity: 'Stickers : {count} · Capacité : {capacity}',
    overflow: 'Certains stickers ne tiennent pas. Activez l’ajustement automatique, agrandissez la planche ou réduisez la taille des stickers, l’espacement ou les marges. Le téléchargement sera disponible quand tous les stickers tiendront.',
    empty: 'Fermez cette fenêtre et sélectionnez des bots ou importez un visuel de marque dans Figés pour créer une planche.',
    loading: 'Préparation de l’aperçu…',
    download: 'Télécharger le visuel + la découpe',
    downloading: 'Préparation du téléchargement…',
    downloaded: 'Planche de stickers téléchargée',
    close: 'Fermer',
    retry: 'Réessayer',
    invalidDimensions: 'Saisissez une largeur et une hauteur positives et finies.',
    invalidSize: 'Saisissez une taille de sticker positive et finie.',
    invalidBorder: 'La bordure doit être positive ou nulle et inférieure à la moitié de la taille du sticker.',
    invalidSpacing: 'Saisissez un espacement strictement positif.',
    invalidMargin: 'Saisissez une marge positive ou nulle qui laisse de la place dans la planche.',
    invalidColor: 'Saisissez une couleur hexadécimale à six chiffres, par exemple #ffffff.',
    invalidPreset: 'Choisissez un format prédéfini ou Personnalisé.',
    noCapacity: 'Aucun sticker ne tient. Agrandissez la planche ou réduisez la taille des stickers, la bordure blanche ou les marges.',
    invalidGeometry: 'Un sticker ne permet pas de produire un contour de découpe fermé valide. Essayez une bordure plus fine ou une autre forme.',
    renderError: 'L’aperçu de la planche n’a pas pu être préparé. Réessayez.',
    exportError: 'La planche n’a pas pu être téléchargée. Réessayez.'
  },

  preview: {
    exit: "Quitter l'aperçu",
    /** Nom de la touche tel qu'il est grave sur le clavier de la langue. */
    key: 'Échap'
  },

  timeline: {
    play: 'Lancer la lecture',
    pause: 'Arrêter la lecture',
    addAnimation: 'Ajouter une animation',
    preview: 'Aperçu',
    export: 'Exporter le montage',
    zoom: 'Zoom de la piste',
    blockAria: '{state}, {duration}',
    blockDurationAria: 'Durée de {state}, {duration}',
    blockRemoveAria: 'Retirer {state}'
  },

  dialog: {
    cancel: 'Annuler',
    nameCreateTitle: 'Nouveau cycle',
    nameRenameTitle: 'Renommer le cycle',
    nameField: 'Nom du cycle',
    nameCreate: 'Créer',
    nameRename: 'Renommer',
    removeTitle: 'Supprimer « {name} » ?',
    removeDetail:
      'Ce montage sera perdu, avec son animation. | Ce montage sera perdu, avec ses {n} animations.',
    removeConfirm: 'Supprimer'
  },

  cycles: {
    defaultName: 'Cycle par défaut',
    newName: 'Mon cycle',
    menuNew: 'Nouveau cycle',
    menuRenameAria: 'Renommer {name}',
    menuRemoveAria: 'Supprimer {name}'
  },

  units: {
    seconds: '{n} s',
    /** Graduation de la règle : serré, le chiffre est déjà petit. */
    secondsShort: '{n}s'
  },

  settings: {
    title: 'Réglages',
    language: 'Langue',
    about: 'À propos',
    credits: 'Créé avec ❤️ par {name}',
    creditsAria: 'Jérémy sur X, dans un nouvel onglet',
    github: 'Voir le projet sur GitHub',
    githubAria: 'Le dépôt du projet sur GitHub, dans un nouvel onglet'
  },

  states: {
    idle: 'Repos',
    thinking: 'Réflexion',
    wink: "Clin d'œil",
    wide: 'Yeux écarquillés',
    alert: 'Alerte',
    notify: 'Notification',
    exclaim: 'Exclamation',
    sleep: 'Veille',
    egg: 'Œuf',
    hexagon: 'Hexagone',
    play: 'Lecture',
    orbit: 'Orbite',
    burst: 'Éclatement',
    comet: 'Comète',
    swirl: 'Tourbillon'
  },

  shapes: {
    cercle: 'Cercle',
    galet: 'Galet',
    squircle: 'Squircle',
    capsule: 'Capsule',
    triangle: 'Triangle',
    hexagone: 'Hexagone',
    nuage: 'Nuage',
    goutte: 'Goutte'
  },

  colors: {
    encre: 'Encre',
    creme: 'Crème',
    brun: 'Brun',
    rouge: 'Rouge',
    orange: 'Orange',
    ambre: 'Ambre',
    vert: 'Vert',
    turquoise: 'Turquoise',
    bleu: 'Bleu',
    violet: 'Violet',
    rose: 'Rose',
    gris: 'Gris'
  },

  expressions: {
    neutre: 'Neutre',
    attentif: 'Attentif',
    surpris: 'Surpris',
    excite: 'Excité',
    heureux: 'Heureux',
    hilare: 'Hilare',
    colere: 'En colère',
    triste: 'Triste',
    effraye: 'Effrayé',
    mefiant: 'Méfiant',
    confus: 'Confus',
    curieux: 'Curieux',
    fier: 'Fier',
    timide: 'Timide',
    blase: 'Blasé',
    somnolent: 'Somnolent'
  }
}
