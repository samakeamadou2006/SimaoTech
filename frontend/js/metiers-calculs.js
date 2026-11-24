function centimes(valeur) {
  const texte = String(valeur ?? '').trim().replace(',', '.');
  const correspondance = /^(\d+)(?:\.(\d{1,2}))?$/.exec(texte);
  if (!correspondance) throw new Error('Montant invalide.');
  return (
    BigInt(correspondance[1]) * 100n +
    BigInt((correspondance[2] ?? '').padEnd(2, '0') || '0')
  );
}

function millieme(valeur) {
  const texte = String(valeur ?? '').trim().replace(',', '.');
  const correspondance = /^(\d+)(?:\.(\d{1,3}))?$/.exec(texte);
  if (!correspondance) throw new Error('Quantite invalide.');
  return (
    BigInt(correspondance[1]) * 1000n +
    BigInt((correspondance[2] ?? '').padEnd(3, '0') || '0')
  );
}

function arrondirDivision(numerateur, denominateur) {
  return (numerateur + denominateur / 2n) / denominateur;
}

function formaterCentimes(valeur) {
  return `${valeur / 100n}.${String(valeur % 100n).padStart(2, '0')}`;
}

export function estimerTotalVente(lignes, produits) {
  if (!Array.isArray(lignes) || lignes.length === 0) {
    throw new Error('Ajoutez au moins un article.');
  }
  const indexProduits = new Map(produits.map((produit) => [produit.id, produit]));
  let total = 0n;

  for (const ligne of lignes) {
    const produit = indexProduits.get(ligne.produitId);
    if (!produit) throw new Error('Selectionnez un produit pour chaque ligne.');

    const quantite = millieme(ligne.quantite);
    if (quantite <= 0n) throw new Error('La quantite doit etre superieure a zero.');

    const reduction = centimes(ligne.reduction || '0');
    const reductionUnitaire = arrondirDivision(reduction * 1000n, quantite);
    const prixNetUnitaire = centimes(produit.prix_vente_reference) - reductionUnitaire;
    if (prixNetUnitaire < 0n) {
      throw new Error('La reduction depasse le prix de l article.');
    }

    total += arrondirDivision(prixNetUnitaire * quantite, 1000n);
  }

  return formaterCentimes(total);
}
