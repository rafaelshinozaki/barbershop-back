// Debug script to test CSV parsing
const csvContent = `email,fullName,password,idDocNumber,phone,gender,birthdate,company,professionalSegment,knowledgeApp,zipcode,street,city,neighborhood,state,membership,isActive,language
test@exemplo.com,Teste,Senha123!,12345678901,11999999999,male,1990-01-01,Empresa,Teste,Básico,00000-000,Rua,000,Teste,SP,FREE,false,pt`;

console.log('Testing CSV parsing...\n');

const rows = csvContent.split('\n');
const headers = rows[0].split(',').map((h) => h.trim().replace(/"/g, ''));
const values = rows[1].split(',').map((v) => v.trim().replace(/"/g, ''));

console.log('Headers:', headers);
console.log('Values:', values);
console.log('\nColumn mapping:');

headers.forEach((header, index) => {
  console.log(`${index}: ${header} = "${values[index]}"`);
});

console.log('\nChecking specific fields:');
const membershipIndex = headers.indexOf('membership');
const stateIndex = headers.indexOf('state');
const isActiveIndex = headers.indexOf('isActive');

console.log(`membership index: ${membershipIndex}, value: "${values[membershipIndex]}"`);
console.log(`state index: ${stateIndex}, value: "${values[stateIndex]}"`);
console.log(`isActive index: ${isActiveIndex}, value: "${values[isActiveIndex]}"`);
