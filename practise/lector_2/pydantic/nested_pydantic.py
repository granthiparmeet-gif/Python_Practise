from pydantic import BaseModel

class Address(BaseModel):
    house : str
    area : str
    pincode : int

class Patient(BaseModel):
    name : str
    address : Address

x = {"house": "Row house A-8",
 "area" : "Devanagri",
 "pincode" : 431001
}

ad = Address(**x)

a = {"name" : "Parmeet", "address": ad}

patient_info = Patient(**a)

print(patient_info.address.pincode)

x = patient_info.model_dump(exclude="name")
print(x)
print(type(x))

